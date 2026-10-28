/*
 * 新版巡护核心脚本
 * 架构（仿神奇海洋）：
 * 1. 进入巡护 → 根据文本判断版本（"切换旧版"=新版巡护，"新版巡护"=旧版巡护），
 *    旧版先校验保护地再点击"新版巡护"，最终校验新版巡护界面，失败返回 false（由调用方处理）
 * 2. 获取所有已开启的巡护地：切换地图 → 校验当前巡护地页面 → 切换保护地
 *    → 校验巡护地选取页面 → 收集文本匹配 ".*已开启" 的可点击 Button → back 返回
 * 3. 遍历每个巡护地：进入保护地 → 校验新版巡护界面（失败则 back 一次，仍失败则完整重进）
 * 4. 在每个巡护地执行完整任务（executePatrolTasks）：
 *    - 点击"更多步数"进入任务界面
 *    - 循环领取奖励 + 执行探索任务（EXPLORE_BUTTONS），支持滑动查找
 *    - 关闭任务页回到巡护界面（不在任务界面则重新进入）
 *    - 执行巡护（doPatrol：点击"GO"等）
 * 单个巡护地失败只记录并跳过，继续下一个
 */
let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let args = config.parseExecArgv()
let singletonRequire = require('../lib/SingletonRequirer.js')(runtime, global)
let automator = singletonRequire('Automator')
let { debugInfo, warnInfo, errorInfo, infoLog, logInfo, debugForDev } = singletonRequire('LogUtils')
let commonFunction = singletonRequire('CommonFunction')
let widgetUtils = singletonRequire('WidgetUtils')
let FloatyInstance = singletonRequire('FloatyUtil')
let LogFloaty = singletonRequire('LogFloaty')
let runningQueueDispatcher = singletonRequire('RunningQueueDispatcher')
let localOcrUtil = require('../lib/LocalOcrUtil.js')
let OpenCvUtil = require('../lib/OpenCvUtil.js')
let widgetInspector = require('../lib/WidgetInspector.js')(runtime, global)
let killProcessUtil = require('../lib/KillProcessUtil.js')
let SwitchToApp = require('../lib/SwitchToApp.js')(runtime, global)
let resourceMonitor = require('../lib/ResourceMonitor.js')(runtime, global)

runningQueueDispatcher.addRunningTask()

let SCALE_RATE = config.scaleRate
let cvt = (v) => parseInt(v * SCALE_RATE)

// 调试日志（悬浮窗显示）
function taskLog (msg) {
  LogFloaty.pushLog(msg)
}

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
      { pkg: 'com.jifen.qukan', name: '趣头条' }
    ], function(name, success) {
      taskLog(name + ' → ' + (success ? '✓ 已杀掉' : '✗ 失败'))
    })
  } catch (e) {
    taskLog('kill进程失败: ' + e)
  }
}

/**
 * 结束新版巡护：最小化窗口并清理
 */
function exitScript () {
  commonFunction.minimize()
  sleep(1000)
  killApps()
  sleep(1000)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exitScript()
}

// 注册自动移除运行中任务
commonFunction.registerOnEngineRemoved(function () {
  config.resetBrightness && config.resetBrightness()
  debugInfo('校验并移除已加载的dex')
  if (typeof destoryPool != 'undefined') {
    destoryPool()
  }
  runningQueueDispatcher.removeRunningTask(true, false, () => {
    config.isRunning = false
  })
}, 'main')

// ============ 工具函数 ============

function clickPoint (x, y) {
  automator.click(x, y)
}

function goBack () {
  back()
  sleep(4000)
}

function sleepIfNeeded (time) {
  if (time > 0) {
    sleep(time)
  }
}

// 遍历可见区域内的控件，用正则 pattern 匹配文本，匹配到第一个符合条件的节点即点击并返回 true；未匹配到返回 false
function findAndClickByTextVisible (pattern) {
  let result = widgetInspector.detectAllNodesVisible()
  for (let node of result.nodes) {
    if (pattern.test(node.text)) {
      let bd = node.bounds
      if (bd) {
        taskLog('找到"' + node.text + '"，点击: (' + bd.centerX() + ', ' + bd.centerY() + ')')
        automator.click(bd.centerX(), bd.centerY())
        return true
      }
    }
  }
  return false
}

// 通过OCR识别并点击指定关键词
// 在 timeout 时间内循环截屏识别，命中即点击返回 true
function clickByOcr (keyword, timeout) {
  if (!localOcrUtil.enabled) return false
  let deadline = new Date().getTime() + (timeout || 10000)
  while (new Date().getTime() < deadline) {
    commonFunction.requestScreenCaptureOrRestart()
    sleep(1000)
    let screen = commonFunction.captureScreen()
    if (screen) {
      let results = localOcrUtil.recognizeWithBounds(screen, null, keyword)
      screen.recycle()
      if (results && results.length > 0) {
        let match = results[0]
        taskLog('OCR找到"' + keyword + '"，点击: (' + match.bounds.centerX() + ', ' + match.bounds.centerY() + ')')
        automator.click(match.bounds.centerX(), match.bounds.centerY())
        sleep(1000)
        return true
      }
    }
    sleep(1000)
  }
  return false
}

// ============ 进入巡护（判断版本并确保新版界面） ============

// 打开巡护并确保最终处于新版巡护界面
// 1. startActivity 进入页面
// 2. 根据文本判断版本："切换旧版"→新版；"新版巡护"→旧版；都没有→默认新版
// 3. 旧版：先校验旧版巡护界面（保护地），再点击"新版巡护"
// 4. 最终统一用 isOnNewPatrolPage 校验
function openPatrol () {
  taskLog('进入巡护')

  commonFunction.backHomeIfInVideoPackage()

  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=68687842',
    packageName: config.package_name
  })

  // 处理"打开"确认弹窗
  let confirm = widgetUtils.widgetGetOne(/^打开$/, 10000)
  if (confirm) {
    automator.clickCenter(confirm)
  }

  // 等待页面加载
  sleep(4000)

  // 判断当前版本（完全匹配）
  if (widgetUtils.widgetGetOne(/^切换旧版$/, 3000)) {
    taskLog('检测到"切换旧版"，已在新版巡护')
  } else if (widgetUtils.widgetGetOne(/^新版巡护$/, 3000)) {
    taskLog('检测到"新版巡护"，当前在旧版巡护')
    // 先确认在旧版巡护界面
    if (!isOnProtectedArea()) {
      LogFloaty.pushErrorLog('不在旧版巡护界面，退出脚本')
      return false
    }
    // 点击进入新版巡护
    if (!enterNewPatrol()) {
      LogFloaty.pushErrorLog('点击"新版巡护"失败，退出脚本')
      return false
    }
  } else {
    taskLog('未检测到版本标识，默认在新版巡护')
  }

  // 统一校验新版巡护界面
  if (!isOnNewPatrolPage()) {
    LogFloaty.pushErrorLog('不在新版巡护界面，退出脚本')
    return false
  }

  taskLog('进入新版巡护成功')
  return true
}

// 判断是否在旧版巡护界面（逻辑与 isOnRewardPage 一致，全部文本都检测到才算成功）
// 匹配文本："路线" "图鉴"
function isOnProtectedArea () {
  let texts = ['路线', '图鉴']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], texts[i], 10000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在旧版巡护界面')
      return false
    }
    taskLog('检测到"' + texts[i] + '"')
  }
  taskLog('全部文本检测到，确认在旧版巡护界面')
  sleep(4000) // 等待界面加载完成
  return true
}

// 判断是否在新版巡护界面（全部文本都检测到才算成功）
// 匹配文本："累计步数" "累计能量" "更多步数" "排行榜"
function isOnNewPatrolPage () {
  let texts = ['累计步数', '累计能量', '更多步数', '排行榜']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], texts[i], 10000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在新版巡护界面')
      return false
    }
    taskLog('检测到"' + texts[i] + '"')
  }
  taskLog('全部文本检测到，确认在新版巡护界面')
  sleep(4000) // 等待界面加载完成
  return true
}

// 判断是否在任务界面（全部文本都检测到才算成功）
// 匹配文本：".*\d次巡护机会"（\d表示纯数字，不需要完全匹配） "更多巡护步数"
function isOnTaskPage () {
  let texts = ['.*\\d次巡护机会', '更多巡护步数']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], texts[i], 10000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在任务界面')
      return false
    }
    taskLog('检测到"' + texts[i] + '"')
  }
  taskLog('全部文本检测到，确认在任务界面')
  sleep(4000) // 等待界面加载完成
  return true
}

// 点击"新版巡护"进入新版巡护界面
function enterNewPatrol () {
  taskLog('点击"新版巡护"')
  if (findAndClickByTextVisible(/新版巡护/)) {
    taskLog('已点击"新版巡护"')
    sleep(4000)
    return true
  }
  LogFloaty.pushErrorLog('未找到"新版巡护"入口')
  return false
}

// 点击"更多步数"进入任务界面
function enterTaskPage () {
  taskLog('点击"更多步数"进入任务界面')
  if (findAndClickByTextVisible(/更多步数/)) {
    taskLog('已点击"更多步数"')
    sleep(4000)
    return true
  }
  LogFloaty.pushErrorLog('未找到"更多步数"入口')
  return false
}

// ============ 巡护地遍历 ============

// 判断是否在当前巡护地页面（全部文本都检测到才算成功）
// 匹配文本："切换保护地" "巡护地图" "巡护进度"
function isOnCurrentMapPage () {
  let texts = ['切换保护地', '巡护地图', '巡护进度']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], texts[i], 5000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在当前巡护地页面')
      return false
    }
    taskLog('检测到"' + texts[i] + '"')
  }
  taskLog('全部文本检测到，确认在当前巡护地页面')
  sleep(4000) // 等待界面加载完成
  return true
}

// 判断是否在巡护地选取页面（全部文本都检测到才算成功）
// 匹配文本："回到当前地图" "保护地列表"
function isOnAreaSelectPage () {
  let texts = ['回到当前地图', '保护地列表']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], texts[i], 5000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在巡护地选取页面')
      return false
    }
    taskLog('检测到"' + texts[i] + '"')
  }
  taskLog('全部文本检测到，确认在巡护地选取页面')
  sleep(4000) // 等待界面加载完成
  return true
}

// 获取所有已开启的巡护地文本（去重），失败返回 null
function getAllPatrolAreas () {
  taskLog('开始获取所有巡护地')

  // 进入当前巡护地页面
  if (!findAndClickByTextVisible(/切换地图/)) {
    taskLog('未找到"切换地图"')
    return null
  }
  sleep(4000)
  if (!isOnCurrentMapPage()) return null

  // 进入巡护地选取页面
  if (!findAndClickByTextVisible(/切换保护地/)) {
    taskLog('未找到"切换保护地"')
    return null
  }
  sleep(4000)
  if (!isOnAreaSelectPage()) return null

  // 收集可点击 Button 中文本匹配 .*已开启 的巡护地
  let areas = []
  try {
    let buttons = className('android.widget.Button').clickable().find()
    for (let i = 0; i < buttons.size(); i++) {
      let btn = buttons.get(i)
      let text = btn.text()
      if (text && /.*已开启/.test(text)) {
        if (areas.indexOf(text) < 0) {
          areas.push(text)
          taskLog('发现巡护地: ' + text)
        }
      }
    }
  } catch (e) {
    taskLog('获取巡护地异常: ' + e)
  }
  taskLog('共获取到 ' + areas.length + ' 个巡护地')

  // 返回一次，回到新版巡护界面
  back()
  sleep(4000)
  if (!isOnNewPatrolPage()) {
    taskLog('back后不在新版巡护界面，重新进入')
    if (!openPatrol()) {
      taskLog('重新进入新版巡护失败')
      return null
    }
  }

  return areas
}

// 点击指定文本的巡护地按钮
function clickAreaButton (areaText) {
  try {
    let buttons = className('android.widget.Button').clickable().find()
    for (let i = 0; i < buttons.size(); i++) {
      let btn = buttons.get(i)
      let text = btn.text()
      if (text && text === areaText) {
        taskLog('点击巡护地: ' + text)
        automator.clickCenter(btn)
        sleep(4000)
        return true
      }
    }
  } catch (e) {
    taskLog('点击巡护地异常: ' + e)
  }
  taskLog('未找到巡护地: ' + areaText)
  return false
}

// 进入指定巡护地并校验新版巡护界面
// 点击后若不在新版巡护界面，back 一次重试；仍不在则完整重进
function enterPatrolArea (areaText) {
  taskLog('进入巡护地: ' + areaText)

  // 进入当前巡护地页面
  if (!findAndClickByTextVisible(/切换地图/)) {
    taskLog('未找到"切换地图"')
    return false
  }
  sleep(4000)
  if (!isOnCurrentMapPage()) return false

  // 进入巡护地选取页面
  if (!findAndClickByTextVisible(/切换保护地/)) {
    taskLog('未找到"切换保护地"')
    return false
  }
  sleep(4000)
  if (!isOnAreaSelectPage()) return false

  // 点击目标保护地
  if (!clickAreaButton(areaText)) return false

  // 校验新版巡护界面
  if (isOnNewPatrolPage()) return true

  // 兜底：back 一次，重新判断
  taskLog('back后重新校验是否在新版巡护界面')
  back()
  sleep(4000)
  if (isOnNewPatrolPage()) {
    taskLog('back后已回到新版巡护界面')
    return true
  }

  // 仍不在：完整重进
  taskLog('back后仍不在新版巡护界面，完整重进')
  return openPatrol()
}

// ============ 任务常量 ============

// 特殊任务：匹配到则走对应分支（去兑换：点击后弹窗点击"立即兑换"）
const SPECIAL_TASKS = [
  { keyword: '去兑换', action: 'clickTarget', clickTarget: '立即兑换', waitTime: 0 }
]

// 排除项：无，留空
const SKIP_KEYWORDS = []

// 长等待关键词：让闲置循环起来
const LONG_WAIT_KEYWORDS = ['让闲置循环起来']

// 探索任务按钮（完全匹配）
const EXPLORE_BUTTONS = ['去看看', '逛一逛', '去参与', '去兑换']

// ============ 任务执行 ============

// 查找同行内是否命中排除项（逐节点判断，阈值200）
function findSkipInSameRow (allNodes, centerY, keywords) {
  for (let node of allNodes) {
    let text = node.text
    if (!text) continue
    for (let kw of keywords) {
      if (text.indexOf(kw) >= 0) {
        let y = node.bounds.centerY()
        if (Math.abs(y - centerY) < 200) {
          return text
        }
      }
    }
  }
  return null
}

// 查找同行内是否命中特殊任务（逐节点判断，阈值200）
function findSpecialTaskInSameRow (allNodes, centerY) {
  for (let node of allNodes) {
    let text = node.text
    if (!text) continue
    for (let st of SPECIAL_TASKS) {
      if (text.indexOf(st.keyword) >= 0) {
        let y = node.bounds.centerY()
        if (Math.abs(y - centerY) < 200) {
          return st
        }
      }
    }
  }
  return null
}

// 查找同行内是否匹配到 \d+s（浏览数组），返回秒数；未匹配返回 -1
function findBrowseSecondsInSameRow (allNodes, centerY) {
  for (let node of allNodes) {
    let text = node.text
    if (!text) continue
    let m = text.match(/(\d+)s/)
    if (m && Math.abs(node.bounds.centerY() - centerY) < 200) {
      return parseInt(m[1])
    }
  }
  return -1
}

// 查找同行内是否命中长等待关键词，命中返回25000，否则返回2000
function getWaitTimeForSameRow (allNodes, centerY) {
  for (let node of allNodes) {
    let text = node.text
    if (!text) continue
    for (let kw of LONG_WAIT_KEYWORDS) {
      if (text.indexOf(kw) >= 0) {
        let y = node.bounds.centerY()
        if (Math.abs(y - centerY) < 200) {
          taskLog('附近有"' + text + '"任务，等待25秒')
          return 25000
        }
      }
    }
  }
  return 2000
}

// 处理弹窗：检测"打开"系统弹窗
function handleTaskPopup () {
  taskLog('检查是否有弹窗')
  sleep(1000)
  let openBtn = widgetUtils.widgetGetOne(/^打开$/, 10000)
  if (openBtn) {
    taskLog('检测到系统弹窗，点击"打开"')
    automator.clickCenter(openBtn)
    sleep(4000)
    return true
  }
  taskLog('未检测到弹窗')
  return false
}

/**
 * 等待任务完成并回到任务界面
 * 1. 先检测当前包是否在支付宝，不在则先切入支付宝
 * 2. 走返回逻辑：先检测是否在任务界面，不在则 back，最多 3 次，仍不在则重新进入
 * @returns {boolean} 是否成功回到任务界面
 */
function waitForTaskComplete () {
  taskLog('任务完成，退出页面')
  sleep(4000)

  let pkg = config.package_name || 'com.eg.android.AlipayGphone'

  // 1. 检测当前包是否在支付宝，不在则先切入支付宝
  if (currentPackage() !== pkg) {
    taskLog('当前不在支付宝，切入支付宝')
    let switched = SwitchToApp.switchToApp({
      pkg: pkg,
      cardText: '支付宝',
      onLog: taskLog
    })
    if (!switched) {
      taskLog('切入支付宝失败，重新进入')
      commonFunction.minimize()
      sleep(1000)
      if (!openPatrol() || !enterTaskPage()) {
        taskLog('重新进入任务界面失败')
        return false
      }
      return isOnTaskPage()
    }
    sleep(4000)
  }

  // 2. 返回逻辑：先检测后back，循环直到回到任务界面
  let maxBacks = 3
  for (let i = 0; i < maxBacks; i++) {
    if (isOnTaskPage()) {
      taskLog('已回到任务界面')
      return true
    }
    taskLog('第' + (i + 1) + '次back')
    goBack()
    sleep(2000)
  }

  taskLog('多次back后仍未回到任务界面，重新进入')
  commonFunction.minimize()
  sleep(1000)
  if (!openPatrol() || !enterTaskPage()) {
    taskLog('重新进入任务界面失败')
    return false
  }
  return isOnTaskPage()
}

// 领取所有奖励：点击所有"领取"（完全匹配）
function claimAllRewards () {
  while (findAndClickByTextVisible(/^领取$/)) {
    sleep(2000)
  }
}

// 查找并执行探索任务
function findAndExecuteExploreTask () {
  let result = widgetInspector.detectAllNodesVisible()
  let allNodes = result.nodes
  if (!allNodes || allNodes.length === 0) {
    taskLog('未检测到任何控件')
    return false
  }

  for (let node of allNodes) {
    let text = node.text
    if (!text) continue

    let isTarget = false
    for (let btn of EXPLORE_BUTTONS) {
      if (text === btn) {
        isTarget = true
        break
      }
    }
    if (!isTarget) continue

    let bd = node.bounds
    if (!bd) continue
    let centerY = bd.centerY()

    // 排除项：同行含 SKIP_KEYWORDS 则跳过
    let skipText = findSkipInSameRow(allNodes, centerY, SKIP_KEYWORDS)
    if (skipText) {
      taskLog('跳过"' + skipText + '"行的按钮: "' + text + '"')
      continue
    }

    // 特殊任务判断
    let specialTask = findSpecialTaskInSameRow(allNodes, centerY)

    taskLog('找到探索任务按钮: "' + text + '" 点击: (' + bd.centerX() + ', ' + bd.centerY() + ')')
    automator.click(bd.centerX(), bd.centerY())
    sleep(2000)
    handleTaskPopup()

    if (specialTask) {
      taskLog('走特殊任务分支: ' + specialTask.keyword)
      if (specialTask.action === 'clickTarget' && specialTask.clickTarget) {
        if (findAndClickByTextVisible(new RegExp(specialTask.clickTarget))) {
          taskLog('已点击"' + specialTask.clickTarget + '"')
        } else {
          taskLog('未找到"' + specialTask.clickTarget + '"')
        }
        if (specialTask.waitTime > 0) {
          sleep(specialTask.waitTime)
        }
      }
    } else {
      // 普通任务：同行匹配到 \d+s 则浏览 \d+2s，否则等待25s（当前统一覆盖）
      let browseSeconds = findBrowseSecondsInSameRow(allNodes, centerY)
      if (browseSeconds > 0) {
        let waitTime = (browseSeconds + 2) * 1000
        taskLog('同行匹配到' + browseSeconds + 's，浏览 ' + (browseSeconds + 2) + 's')
        sleep(waitTime)
      } else {
        let waitTime = getWaitTimeForSameRow(allNodes, centerY)
        // 暂时将普通任务等待时间统一设置为25s
        waitTime = 25000
        taskLog('普通任务，等待' + (waitTime / 1000) + 's')
        sleep(waitTime)
      }
    }

    taskLog('任务执行完毕，等待回到任务界面')
    return waitForTaskComplete()
  }

  taskLog('未找到可执行的探索任务')
  return false
}

// 点击"关闭"回到巡护界面（有多个关闭，点击y最大的那个）
function closeTaskPage () {
  taskLog('点击"关闭"返回巡护界面')
  let result = widgetInspector.detectAllNodesVisible()
  let target = null
  let maxY = -1
  for (let node of result.nodes) {
    if (node.text && node.text.indexOf('关闭') >= 0) {
      let bd = node.bounds
      if (bd && bd.centerY() > maxY) {
        maxY = bd.centerY()
        target = bd
      }
    }
  }
  if (target) {
    taskLog('找到"关闭"，点击: (' + target.centerX() + ', ' + target.centerY() + ')')
    automator.click(target.centerX(), target.centerY())
    sleep(4000)
    return true
  }
  taskLog('未找到"关闭"按钮')
  return false
}

// 处理巡护弹窗：do...while 循环检测"跳过|追寻踪迹|暂不设置"（完全匹配）或"继续巡护"（前缀匹配），检测到就点击（等8s），没有就 return
function handleCollectPopup () {
  taskLog('检查是否有弹窗')
  sleep(1000)

  do {
    let btn = widgetUtils.widgetGetOne(/(^(跳过|追寻踪迹|暂不设置)$|继续巡护.*)/, 10000)
    if (!btn) {
      taskLog('未检测到弹窗，返回')
      return
    }
    taskLog('检测到弹窗，点击')
    automator.clickCenter(btn)
    sleep(8000)
  } while (true)
}

// 巡护：执行一个3次的循环
// 点击"GO" → 等待6s → handleCollectPopup → 判断是否在任务界面，在则先关闭任务页再跳出循环
function doPatrol () {
  taskLog('=== 新版巡护 开始巡护 ===')
  for (let i = 0; i < 3; i++) {
    taskLog('第 ' + (i + 1) + ' 次巡护')

    // 点击"GO"
    if (!findAndClickByTextVisible(/^GO$/)) {
      taskLog('未找到"GO"按钮')
      break
    }

    // 等待6s
    sleep(6000)

    // 处理弹窗（跳过 | 追寻踪迹 | 暂不设置 | 继续巡护）
    handleCollectPopup()

    // 判断是否在任务界面，在则先关闭任务页再跳出循环
    if (isOnTaskPage()) {
      taskLog('已进入任务界面，先关闭任务页再跳出巡护循环')
      closeTaskPage()
      break
    }
  }
}

// 在当前巡护地执行完整任务：探索任务 → 关闭任务页（不在任务界面则重进）→ 巡护
// 失败返回 false，由主循环记录并跳过、继续下一个巡护地
function executePatrolTasks () {
  taskLog('=== 执行探索任务 ===')

  // 点击"更多步数"进入任务界面
  if (!enterTaskPage()) {
    errorInfo('无法进入任务界面')
    return false
  }

  // 判断是否在任务界面
  if (!isOnTaskPage()) {
    errorInfo('不在任务界面')
    return false
  }

  // 循环执行探索任务，直到没有可执行任务为止
  let maxRounds = 15   // 轮次上限，防止死循环
  let maxScrolls = 15  // 滑动上限，防止死循环
  let scrollCount = 0
  let round = 0
  while (round < maxRounds) {
    round++
    taskLog('=== 新版巡护 第 ' + round + ' 轮探索任务 ===')

    // 领取所有奖励
    claimAllRewards()

    let executed = false
    try {
      executed = findAndExecuteExploreTask()
    } catch (e) {
      let errMsg = e && e.message ? e.message : e
      errorInfo('探索任务异常: ' + errMsg)
    }
    if (executed) {
      // 任务执行完毕回到任务界面后，继续下一轮查找
      scrollCount = 0   // 执行了任务，重置滑动计数
      if (!isOnTaskPage()) {
        taskLog('不在任务界面，退出探索任务循环')
        break
      }
      continue
    }

    // 没有可执行任务：检查是否滑到底部（找到停止文本"继续看"或"已领取"）
    let result = widgetInspector.detectAllNodesVisible()
    let hasEnd = result.nodes.some(n => n.text && (n.text.indexOf('继续看') >= 0 || n.text.indexOf('已领取') >= 0))
    if (hasEnd) {
      taskLog('已滑到底部（找到"继续看"或"已领取"），退出探索任务循环')
      break
    }

    // 未到底：滑动继续查找
    if (scrollCount >= maxScrolls) {
      taskLog('滑动已达上限，退出探索任务循环')
      break
    }
    scrollCount++
    taskLog('没有更多任务可执行，滑动屏幕继续查找')
    let h = config.device_height
    // 下滑：起始75%~85%随机，距离15%~20%随机，startY大值 endY小值
    let downStart = (0.75 + Math.random() * 0.10) * h
    let downDist = (0.15 + Math.random() * 0.05) * h
    let downDuration = 100 + Math.random() * 300
    automator.gestureDown(Math.round(downStart), Math.round(downStart - downDist), downDuration)
    sleep(2000)
  }

  // 探索任务执行完 → 判断是否在任务界面，在则点击"关闭"回到巡护界面，不在则重新进入
  if (isOnTaskPage()) {
    closeTaskPage()
  } else {
    taskLog('不在任务界面，重新进入')
    commonFunction.minimize()
    sleep(1000)
    if (!openPatrol()) {
      errorInfo('重新进入新版巡护失败')
      return false
    }
  }

  // 判断是否在新版巡护界面
  if (!isOnNewPatrolPage()) {
    errorInfo('不在新版巡护界面')
    return false
  }

  // 执行巡护（找不到 GO 表示次数用完，不算失败）
  doPatrol()
  return true
}

// ============ 主流程 ============

function main () {
  infoLog('运行中可按音量上键关闭', true)
  threads.start(function () {
    events.observeKey()
    events.on("key_down", function (keyCode, event) {
      if (keyCode === 24) {
        toastLog('用户按音量上键，退出脚本')
        killApps()
        runningQueueDispatcher.removeRunningTask()
        exit()
      }
    })
  })

  // 1. 进入巡护，自动判断版本并确保处于新版巡护界面
  if (!openPatrol()) {
    errorInfo('无法进入新版巡护界面，退出新版巡护')
    exitScript()
  }

  // 2. 获取所有已开启的巡护地
  let areas = getAllPatrolAreas()
  if (!areas || areas.length === 0) {
    taskLog('未获取到巡护地，仅执行当前巡护地')
    areas = [null]
    // 确保回到新版巡护界面
    if (!isOnNewPatrolPage()) {
      if (!openPatrol()) {
        errorInfo('无法回到新版巡护界面，退出新版巡护')
        exitScript()
      }
    }
  }

  // 3. 遍历所有巡护地，单个失败只记录并跳过
  for (let i = 0; i < areas.length; i++) {
    let label = areas[i] || '当前巡护地'
    taskLog('=== 巡护地 ' + (i + 1) + '/' + areas.length + ': ' + label + ' ===')

    // 进入保护地失败：记录后跳过，继续下一个
    if (areas[i] && !enterPatrolArea(areas[i])) {
      taskLog('进入巡护地失败，跳过: ' + label)
      openPatrol()
      continue
    }

    // 任务执行失败：记录后跳过，继续下一个
    if (!executePatrolTasks()) {
      taskLog('巡护任务执行失败，跳过: ' + label)
      openPatrol()
      continue
    }
  }

  taskLog('新版巡护任务完成，返回')
  exitScript()
}

main()
