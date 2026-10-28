/*
 * @Description: 夜间任务 - 串行执行多个子脚本（编排器）
 * ------------------------------------------------------------------
 * 【兜底规则 · 重要】
 *   夜间任务必须在 06:55 之前结束。
 *   · 到达 06:55 后不再启动任何新任务；
 *   · 正在执行的子脚本会被强制终止；
 *   · 随后清理进程、回到桌面并退出（是否锁屏由父脚本按 needRelock 判断）。
 *   DEADLINE_HOUR / DEADLINE_MINUTE 定义在下方常量区，修改时请同步核对。
 * ------------------------------------------------------------------
 * 设计说明：
 *   1. 严格串行，不会并发执行多个子脚本：
 *      · execScriptFile 启动本身是异步的，但启动后立即阻塞等待该引擎销毁才继续下一个；
 *      · 用「启动前后的引擎 id 快照差值」定位刚启动的引擎，同名脚本重复执行也不会认错；
 *      · forceStop() 同样是异步的，强杀后会 waitDestroyed() 轮询等待引擎销毁（最多 10 秒），
 *        避免上一个未死透时下一个就启动。
 *   2. 本脚本不注册运行队列（RunningQueueDispatcher），避免与子脚本互相阻塞。
 *   3. 每个子脚本执行结束后：等待 10s → killApps() → 等待 2s；等待期间悬浮窗持续显示当前子脚本并倒计时。
 *   4. 保持亮屏：开头 device.keepScreenOn()，结束时 device.cancelKeepingAwake()。
 *      wake lock 绑定当前引擎，本引擎整夜存活，可覆盖子脚本之间的空档期。
 *   5. 本脚本不弹倒计时弹窗、也不锁屏（与其它子脚本一致），弹窗和锁屏都由父脚本 夜间任务自动启动.js 统一负责。
 *   6. 中断方式：音量上键（keyCode 24）。与各子脚本一样用 events.on('key_down') 监听；
 *      按下后终止当前子脚本、释放亮屏锁并杀掉后台进程，直接退出（不回桌面、不打印总账）。
 *   7. 汇总日志只记录每个任务的「次数 / 耗时 / 结果」，结束时输出一条总账。
 *   8. 建议通过 run/夜间任务自动启动.js 运行（由它负责解锁、静音、弹窗、锁屏）。
 *   9. 本脚本只管控自己拉起的子脚本；夜间窗口内若还有其他定时任务到点触发，
 *      那是独立引擎、不受本脚本管控，建议把窗口内的原定时任务关闭，只保留夜间任务一条。
 */

let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let sRequire = require('../lib/SingletonRequirer.js')(runtime, global)
let FileUtils = sRequire('FileUtils')
let commonFunction = sRequire('CommonFunction')
let { debugInfo, warnInfo, errorInfo, infoLog } = sRequire('LogUtils')
let killProcessUtil = require('../lib/KillProcessUtil.js')

// ============================================================
// 【兜底】夜间任务必须在 06:55 之前结束
// ============================================================
const DEADLINE_HOUR = 6
const DEADLINE_MINUTE = 55

// 子脚本执行结束后的固定等待（通过悬浮窗逐秒倒数）
const AFTER_SCRIPT_WAIT = 10 * 1000   // 结束后等待 10s
const AFTER_KILL_WAIT = 2 * 1000      // killApps 后等待 2s

// 夜间任务悬浮窗相对子脚本/主脚本悬浮窗下移的像素，避免顶部重叠（详见 showFloaty）
const FLOATY_Y_OFFSET = 80

// ============================================================
// 任务数组
//   name           : 脚本名，默认对应 run/<name>.js
//   file           : 文件名（可选，缺省为 name + '.js'）
//   count          : 执行次数
//   timeoutMinutes : 单次执行超时（分钟），超过则强制杀掉该子脚本
// 顺序即为执行顺序。窗口为 01:00 - 06:55（07:00 后的任务不纳入）。
// ============================================================
const NIGHT_TASK_LIST = [
  { name: '能量雨兑换', count: 2, timeoutMinutes: 5 },
  { name: '能量雨', count: 1, timeoutMinutes: 5 },
  { name: '赚能量', count: 2, timeoutMinutes: 5 },
  { name: '森林集市', count: 2, timeoutMinutes: 5 },
  { name: '新版巡护', count: 2, timeoutMinutes: 10 },
  { name: '森林寻宝', count: 2, timeoutMinutes: 10 },
  { name: '神奇海洋', count: 1, timeoutMinutes: 40 },
  { name: 'AI摸鱼', count: 2, timeoutMinutes: 40 },
  { name: '乐园任务', count: 2, timeoutMinutes: 40 },
  { name: '每日任务', count: 2, timeoutMinutes: 40 },
  { name: '神奇鱼塘', count: 2, timeoutMinutes: 5 },
  { name: '能量雨', count: 1, timeoutMinutes: 5 }
]

config.not_lingering_float_window = true
if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exit()
}

let mainScriptPath = FileUtils.getRealMainScriptPath(true)

// 运行中可按音量上键中止整个夜间任务
let userAborted = false
let currentEngine = null

// 计算本次运行的兜底截止时间：当天 06:55，若已过则顺延到次日（正常夜间运行不会走到次日分支）
function getDeadlineTimestamp () {
  let d = new Date()
  d.setHours(DEADLINE_HOUR, DEADLINE_MINUTE, 0, 0)
  if (d.getTime() <= new Date().getTime()) {
    d.setDate(d.getDate() + 1)
  }
  return d.getTime()
}
let deadline = getDeadlineTimestamp()

function deadlineReached () {
  return new Date().getTime() >= deadline
}

// 杀掉后台应用（取自 每日任务.js 的 killApps）
function killApps () {
  try {
    killProcessUtil.killMultiple([
      { pkg: config.package_name || 'com.eg.android.AlipayGphone', name: '支付宝' },
      { pkg: 'com.taobao.taobao', name: '淘宝' },
      { pkg: 'com.sankuai.meituan', name: '美团' },
      { pkg: 'com.taobao.idlefish', name: '闲鱼' },
      { pkg: 'com.taobao.etao', name: '一淘' },
      { pkg: 'com.taobao.trip', name: '飞猪' },
      { pkg: 'com.autonavi.minimap', name: '高德地图' },
      { pkg: 'com.taobao.live', name: '点淘' },
      { pkg: 'com.baidu.searchbox.lite', name: '百度极速版' },
      { pkg: 'com.jifen.qukan', name: '趣头条' },
      { pkg: 'com.shuqi.controller', name: '书旗小说' }
    ], function (name, success) {
      debugInfo('[夜间任务] ' + name + ' → ' + (success ? '✓ 已杀掉' : '✗ 失败'))
    })
  } catch (e) {
    debugInfo('[夜间任务] kill进程失败: ' + e)
  }
}

// 毫秒转「x时xx分 / x分xx秒 / x秒」
function formatDuration (ms) {
  let totalSec = Math.floor(ms / 1000)
  let h = Math.floor(totalSec / 3600)
  let m = Math.floor((totalSec % 3600) / 60)
  let s = totalSec % 60
  if (h > 0) {
    return h + '时' + (m < 10 ? '0' + m : m) + '分'
  }
  if (m > 0) {
    return m + '分' + (s < 10 ? '0' + s : s) + '秒'
  }
  return s + '秒'
}

// 悬浮窗显示当前正在执行的子脚本（等待期间也持续显示，避免误以为脚本已结束）
// y 在 min_floaty_y 基础上加 FLOATY_Y_OFFSET：子脚本/主脚本的迷你悬浮窗都在左上角，下移一段避免重叠
// （bang_offset 刘海偏移由 FloatyUtil.setFloatyInfo 内部自动叠加，这里无需再算）
function showFloaty (text) {
  try {
    commonFunction.showMiniFloaty(text, config.min_floaty_x, (config.min_floaty_y || 20) + FLOATY_Y_OFFSET)
  } catch (e) {
    debugInfo('[夜间任务] 悬浮窗更新失败: ' + e)
  }
}

// 带悬浮窗倒计时的等待，明确脚本仍在运行
function waitWithFloaty (totalSeconds, text) {
  for (let i = totalSeconds; i > 0; i--) {
    showFloaty(text + '，等待 ' + i + 's')
    sleep(1000)
  }
}

// 把单任务各次执行结果汇总成一行短文案，如「成功2 超时1」
function buildResultText (results) {
  let finished = 0, timeout = 0, notStarted = 0, deadlineAbort = 0, userStop = 0
  for (let i = 0; i < results.length; i++) {
    if (results[i] === 'finished') finished++
    else if (results[i] === 'timeout') timeout++
    else if (results[i] === 'not_started') notStarted++
    else if (results[i] === 'deadline') deadlineAbort++
    else if (results[i] === 'aborted') userStop++
  }
  let parts = ['成功' + finished]
  if (timeout > 0) parts.push('超时' + timeout)
  if (notStarted > 0) parts.push('未启动' + notStarted)
  if (deadlineAbort > 0) parts.push('兜底中止' + deadlineAbort)
  if (userStop > 0) parts.push('用户中止' + userStop)
  return parts.join(' ')
}

/**
 * 轮询等待引擎真正销毁（forceStop 是异步的，调用后引擎不一定立即结束）
 */
function waitDestroyed (engine, maxMs) {
  let t = new Date().getTime()
  while (!engine.isDestroyed() && new Date().getTime() - t < maxMs) {
    sleep(300)
  }
}

/**
 * 启动单个子脚本并等待其结束（严格阻塞；强杀后最多等待 10 秒确保引擎销毁）
 * 返回 { result: 'finished' | 'timeout' | 'not_started' | 'deadline' | 'aborted', duration: ms }
 */
function runOnce (task, timeoutMs) {
  let fileName = task.file || (task.name + '.js')
  let fullPath = mainScriptPath + '/run/' + fileName
  if (!files.exists(fullPath)) {
    warnInfo('[夜间任务] 脚本不存在：' + fullPath)
    return { result: 'not_started', duration: 0 }
  }

  // 记录启动前的引擎 id 快照，避免同名脚本重复执行时认错引擎
  let beforeIds = engines.all().map(function (e) { return e.id })

  engines.execScriptFile(fullPath, {
    path: mainScriptPath + '/run/',
    arguments: { executeByTimeTask: true }
  })

  // 1) 等待新引擎出现
  let engine = null
  let waitStart = new Date().getTime()
  while (new Date().getTime() - waitStart < 10000) {
    let list = engines.all()
    for (let i = 0; i < list.length; i++) {
      if (beforeIds.indexOf(list[i].id) < 0 && (list[i].getSource() + '') === fullPath) {
        engine = list[i]
        break
      }
    }
    if (engine) break
    sleep(500)
  }
  if (!engine) {
    warnInfo('[夜间任务] 子脚本未能启动：' + fileName)
    return { result: 'not_started', duration: 0 }
  }
  currentEngine = engine

  // 2) 等待执行结束，用户中断 / 超时 / 到达兜底时间则强制终止
  let start = new Date().getTime()
  while (!engine.isDestroyed()) {
    let elapsed = new Date().getTime() - start
    if (userAborted) {
      debugInfo('[夜间任务] 用户按音量上键中止，终止 ' + task.name)
      engine.forceStop()
      waitDestroyed(engine, 10000)
      currentEngine = null
      return { result: 'aborted', duration: elapsed }
    }
    if (elapsed > timeoutMs) {
      debugInfo('[夜间任务] ' + task.name + ' 执行超时，强制终止')
      engine.forceStop()
      // 等待引擎真正销毁，避免与下一个子脚本并发
      waitDestroyed(engine, 10000)
      currentEngine = null
      return { result: 'timeout', duration: elapsed }
    }
    if (deadlineReached()) {
      debugInfo('[夜间任务] 到达兜底时间(' + DEADLINE_HOUR + ':' + DEADLINE_MINUTE + ')，强制终止 ' + task.name)
      engine.forceStop()
      // 等待引擎真正销毁，避免与下一个子脚本并发
      waitDestroyed(engine, 10000)
      currentEngine = null
      return { result: 'deadline', duration: elapsed }
    }
    sleep(3000)
  }
  currentEngine = null
  return { result: 'finished', duration: new Date().getTime() - start }
}

// 音量上键退出（与各子脚本一致：清理必要项后直接退出，不再回到主流程）
function startVolumeKeyExitListener () {
  infoLog('运行中可按音量上键关闭', true)
  threads.start(function () {
    events.observeKey()
    events.on('key_down', function (keyCode, event) {
      if (keyCode === 24) {
        toastLog('用户按音量上键，退出夜间任务')
        // 先立标志，防止收尾期间主循环又拉起下一个子脚本
        userAborted = true
        // 必须项：终止当前子脚本，避免留下孤儿引擎
        if (currentEngine && !currentEngine.isDestroyed()) {
          try {
            currentEngine.forceStop()
            waitDestroyed(currentEngine, 5000)
          } catch (e) {
            debugInfo('[夜间任务] 终止当前子脚本失败: ' + e)
          }
        }
        // 中止路径：不回桌面、不打印总账，释放亮屏锁并杀掉后台进程后直接退出
        device.cancelKeepingAwake()
        killApps()
        exit()
      }
    })
  })
}

function main () {
  infoLog('【夜间任务】开始，共 ' + NIGHT_TASK_LIST.length + ' 个任务，兜底截止 ' + DEADLINE_HOUR + ':' + (DEADLINE_MINUTE < 10 ? '0' + DEADLINE_MINUTE : DEADLINE_MINUTE))
  let totalFinished = 0, totalTimeout = 0, totalNotStarted = 0, totalAborted = 0, totalUserStop = 0
  let totalStart = new Date().getTime()
  let aborted = false

  for (let i = 0; i < NIGHT_TASK_LIST.length; i++) {
    let task = NIGHT_TASK_LIST[i]
    let count = task.count || 1
    let timeoutMs = (task.timeoutMinutes || 40) * 60 * 1000
    let taskStart = new Date().getTime()
    let results = []

    for (let r = 1; r <= count; r++) {
      if (deadlineReached()) {
        results.push('deadline')
        aborted = true
        break
      }
      // 单次超时不得超过剩余的兜底时间
      let effectiveTimeout = Math.min(timeoutMs, deadline - new Date().getTime())
      let taskLabel = '[' + (i + 1) + '/' + NIGHT_TASK_LIST.length + ' ' + task.name + ' ' + r + '/' + count + ']'
      showFloaty('夜间任务' + taskLabel)
      let r0 = runOnce(task, effectiveTimeout)
      results.push(r0.result)
      if (r0.result === 'deadline' || r0.result === 'aborted') {
        aborted = true
        break
      }
      // 子脚本结束后：等待 10s → killApps → 等待 2s（悬浮窗显示倒计时，明确仍在运行）
      waitWithFloaty(AFTER_SCRIPT_WAIT / 1000, '夜间任务' + taskLabel + ' 已完成')
      showFloaty('夜间任务' + taskLabel + ' 清理进程中')
      killApps()
      waitWithFloaty(AFTER_KILL_WAIT / 1000, '夜间任务' + taskLabel + ' 清理进程')
    }

    // 统计
    for (let k = 0; k < results.length; k++) {
      if (results[k] === 'finished') totalFinished++
      else if (results[k] === 'timeout') totalTimeout++
      else if (results[k] === 'not_started') totalNotStarted++
      else if (results[k] === 'deadline') totalAborted++
      else if (results[k] === 'aborted') totalUserStop++
    }

    let duration = new Date().getTime() - taskStart
    infoLog('【夜间任务】' + task.name + ' 次数:' + results.length + '/' + count + ' 耗时:' + formatDuration(duration) + ' 结果:' + buildResultText(results))

    if (aborted || userAborted || deadlineReached()) {
      aborted = true
      break
    }
  }

  // 总账
  let totalDuration = new Date().getTime() - totalStart
  infoLog('【夜间任务】总账：成功 ' + totalFinished + ' 次，超时 ' + totalTimeout + ' 次，未启动 ' + totalNotStarted + ' 次，兜底中止 ' + totalAborted + ' 次，用户中止 ' + totalUserStop + ' 次，总耗时 ' + formatDuration(totalDuration) + (aborted ? (userAborted ? '（用户按音量上键提前结束）' : '（触发兜底提前结束）') : ''))
}

// ============================================================
// 执行入口
// ============================================================
// 正常结束的收尾：回桌面 → 清理进程（不锁屏，与其它子脚本一致；锁屏由父脚本按 needRelock 负责）
function exitScript () {
  device.cancelKeepingAwake()
  commonFunction.minimize()
  sleep(500)
  killApps()
  sleep(500)
  exit()
}

device.keepScreenOn()
startVolumeKeyExitListener()
showFloaty('夜间任务：准备中')
toastLog('夜间任务开始')
main()
toastLog('夜间任务结束')
showFloaty('夜间任务：已结束')
exitScript()
