let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let args = config.parseExecArgv()
let sRequire = require('../lib/SingletonRequirer.js')(runtime, global)
let automator = sRequire('Automator')
let { debugInfo, warnInfo, errorInfo, infoLog, logInfo, debugForDev } = sRequire('LogUtils')
let commonFunction = sRequire('CommonFunction')
let widgetUtils = sRequire('WidgetUtils')
let resourceMonitor = require('../lib/ResourceMonitor.js')(runtime, global)
let FloatyInstance = sRequire('FloatyUtil')
let NotificationHelper = sRequire('Notification')
let LogFloaty = sRequire('LogFloaty')
let localOcrUtil = require('../lib/LocalOcrUtil.js')
let OpenCvUtil = require('../lib/OpenCvUtil.js')
let killProcessUtil = require('../lib/KillProcessUtil.js')
let widgetInspector = require('../lib/WidgetInspector.js')(runtime, global)

// 神奇物种 appId：68687886（与 unit/神奇物种万能卡.js 一致）

function taskLog (msg) {
  LogFloaty.pushLog(msg)
}

function killApps () {
  try {
    let success = killProcessUtil.kill(config.package_name || 'com.eg.android.AlipayGphone')
    debugInfo('支付宝 → ' + (success ? '✓ 已杀掉' : '✗ 失败'))
  } catch (e) {
    debugInfo('kill进程失败: ' + e)
  }
}

let runningQueueDispatcher = sRequire('RunningQueueDispatcher')
runningQueueDispatcher.addRunningTask()

if (!FloatyInstance.init()) {
  toastLog('初始化悬浮窗失败')
  exit()
}
FloatyInstance.enableLog()
if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exit()
}
config.show_debug_log = true
commonFunction.autoSetUpBangOffset(true)

let executeByTimeTask = args.executeByTimeTask
if (executeByTimeTask) {
  // 注册自动移除运行中任务
  commonFunction.registerOnEngineRemoved(function () {
    config.resetBrightness && config.resetBrightness()
    runningQueueDispatcher.removeRunningTask(true, true,
      () => {
        config.isRunning = false
      }
    )
  }, 'main')
}

// 音量上键退出脚本（在独立线程中轮询检测）
infoLog('运行中可按音量上键关闭', true)
threads.start(function () {
  events.observeKey()
  events.on('key_down', function (keyCode, event) {
    if (keyCode === 24) {
      toastLog('用户按音量上键，退出脚本')
      killApps()
      runningQueueDispatcher.removeRunningTask()
      exit()
    }
  })
})

// ============================================================
// 核心逻辑：神奇物种
// ============================================================

// 遍历所有控件，正则匹配文本并点击（参考限时道具兑换 findAndClickByText）
function findAndClickByText (pattern) {
  let result = widgetInspector.detectAllNodes()
  for (let node of result.nodes) {
    if (pattern.test(node.text)) {
      let bd = node.bounds
      if (bd && bd.centerX() >= 0 && bd.centerX() <= config.device_width
          && bd.centerY() >= 0 && bd.centerY() <= config.device_height) {
        taskLog('找到"' + node.text + '"，点击: (' + bd.centerX() + ', ' + bd.centerY() + ')')
        automator.click(bd.centerX(), bd.centerY())
        return true
      }
    }
  }
  return false
}

// 遍历可见区域内的控件，正则匹配文本并点击（参考限时道具兑换 findAndClickByTextVisible）
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

// 返回上一页
function goBack () {
  back()
  sleep(2000)
}

// 打开进入神奇物种的函数
function openMagicSpecies () {
  taskLog('进入神奇物种')

  commonFunction.backHomeIfInVideoPackage()

  // 先杀掉支付宝进程，强制冷启动进入神奇物种主页面（避免停留在好友的卡等子页面）
  killApps()
  sleep(1000)

  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=68687886',
    packageName: config.package_name
  })

  // 处理"打开"确认弹窗
  let confirm = widgetUtils.widgetGetOne(/^打开$/, 1000)
  if (confirm) {
    automator.clickCenter(confirm)
  }

  commonFunction.readyForAlipayWidgets()

  // 每天第一次进入会自动抽取一张卡片，点击"收下"（可能不是第一次进入，无"收下"则跳过，不退出）
  collectFirstCard()

  // 等待进入神奇物种页面
  sleep(2000)

  if (!isOnMagicSpeciesPage()) {
    LogFloaty.pushErrorLog('不在神奇物种页面，退出脚本')
    return false
  }
  taskLog('进入神奇物种成功')
  return true
}

// 判断是否在神奇物种的函数（参考 isOnBackpackPage，任一文本匹配即视为成功："奖励 当前图鉴 抽好友卡片"）
function isOnMagicSpeciesPage () {
  let texts = ['奖励', '当前图鉴', '抽好友卡片']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting('^' + texts[i] + '$', texts[i], 3000)
    if (result) {
      taskLog('检测到"' + texts[i] + '"，确认在神奇物种界面')
      sleep(4000) // 等待界面加载完成
      return true
    }
  }
  taskLog('未检测到"奖励 当前图鉴 抽好友卡片"任一文本，不在神奇物种界面')
  return false
}

// 判断是否在好友的卡页面（任一文本匹配即视为成功："好友的卡" "点击抽卡"）
function isOnFriendCardPage () {
  let texts = ['好友的卡', '点击抽卡']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting('^' + texts[i] + '$', texts[i], 3000)
    if (result) {
      taskLog('检测到"' + texts[i] + '"，确认在好友的卡页面')
      sleep(4000) // 等待界面加载完成
      return true
    }
  }
  taskLog('未检测到"好友的卡 点击抽卡"任一文本，不在好友的卡页面')
  return false
}

// 判断是否在交换页面（任一文本匹配即视为成功："你将获得" "你将换出"）
function isOnExchangePage () {
  let texts = ['你将获得', '你将换出']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting('^' + texts[i] + '$', texts[i], 3000)
    if (result) {
      taskLog('检测到"' + texts[i] + '"，确认在交换页面')
      sleep(4000) // 等待界面加载完成
      return true
    }
  }
  taskLog('未检测到"你将获得 你将换出"任一文本，不在交换页面')
  return false
}

// 循环尝试点击多个关键词：命中任意一个即返回 true（用于“通知好友|获得交换机会”等多选一场景）
function findAndClickAny (patterns) {
  for (let i = 0; i < patterns.length; i++) {
    if (findAndClickByTextVisible(patterns[i])) {
      return true
    }
  }
  return false
}

// 方案一：点击屏幕宽度20%、高度70%处（用于选择交换卡片）
function clickExchangeCardByPosition () {
  let x = parseInt(config.device_width * 0.2)
  let y = parseInt(config.device_height * 0.7)
  taskLog('方案一：点击屏幕(' + x + ', ' + y + ')')
  automator.click(x, y)
  sleep(2000)
  return true
}

// 方案二：在完全匹配"点击选择你要交换的卡片"的下方识别所有纯数字，点击最大的数字
function clickExchangeCardByMaxNumber () {
  let result = widgetInspector.detectAllNodesVisible()
  let anchorCenterY = null

  // 找到完全匹配"点击选择你要交换的卡片"的节点，记录其中心Y坐标
  for (let n of result.nodes) {
    if (n.text && /^点击选择你要交换的卡片$/.test(n.text) && n.bounds) {
      anchorCenterY = n.bounds.centerY()
      taskLog('找到"点击选择你要交换的卡片"，中心Y：' + anchorCenterY)
      break
    }
  }

  if (anchorCenterY === null) {
    LogFloaty.pushErrorLog('未找到"点击选择你要交换的卡片"')
    return false
  }

  // 在锚点下方找所有纯数字控件，记录数字最大的
  let maxNum = -1
  let maxNode = null
  for (let n of result.nodes) {
    if (!n.text || !n.bounds) continue
    if (n.bounds.centerY() < anchorCenterY) continue // 只取锚点下方的
    let m = n.text.match(/^\d+$/)
    if (m) {
      let num = parseInt(m[0], 10)
      if (num > maxNum) {
        maxNum = num
        maxNode = n
      }
    }
  }

  if (maxNode) {
    taskLog('方案二：点击最大数字 ' + maxNum + '，位置：(' + maxNode.bounds.centerX() + ', ' + maxNode.bounds.centerY() + ')')
    automator.click(maxNode.bounds.centerX(), maxNode.bounds.centerY())
    sleep(2000)
    return true
  }

  LogFloaty.pushErrorLog('未在"点击选择你要交换的卡片"下方找到纯数字控件')
  return false
}

// 处理“你还未拥有此物种卡”的交换流程
function doExchangeFlow () {
  taskLog('=== 检测到"你还未拥有此物种卡"，执行交换流程 ===')

  // 通知好友或获得交换机会（点击任何一个），然后点击发送
  if (!findAndClickAny([/^通知好友$/, /^获得交换机会$/])) {
    LogFloaty.pushErrorLog('未找到"通知好友"或"获得交换机会"')
    return false
  }
  sleep(2000)

  // 点击发送
  if (!findAndClickByTextVisible(/^发送$/)) {
    LogFloaty.pushErrorLog('未找到"发送"')
    return false
  }
  sleep(2000)

  // 进入交换页面，判断是否在交换页面
  if (!isOnExchangePage()) {
    LogFloaty.pushErrorLog('未进入交换页面')
    return false
  }

  // 选择交换卡片（优先方案二：点击"点击选择你要交换的卡片"下方最大数字；失败则用方案一：点击屏幕固定位置）
  if (!clickExchangeCardByMaxNumber()) {
    taskLog('方案二失败，改用方案一兜底')
    if (!clickExchangeCardByPosition()) {
      LogFloaty.pushErrorLog('方案一兜底点击交换卡片失败')
      return false
    }
  }

  // 点击"交换"
  if (!findAndClickByTextVisible(/^交换$/)) {
    LogFloaty.pushErrorLog('未找到"交换"')
    return false
  }
  sleep(2000)

  // 点击"确认交换"
  if (!findAndClickByTextVisible(/^确认交换$/)) {
    LogFloaty.pushErrorLog('未找到"确认交换"')
    return false
  }
  widgetUtils.widgetWaiting('^返回首页$', '返回首页', 5000) // 等待"返回首页"出现（完全匹配），总延时5s
  sleep(6000)

  // 点击"继续抽卡"
  if (!findAndClickByTextVisible(/^继续抽卡$/)) {
    LogFloaty.pushErrorLog('未找到"继续抽卡"')
    return false
  }
  sleep(2000)
  return true
}

// 处理"你已拥有"的放弃流程
function doGiveUpFlow () {
  taskLog('=== 检测到"你已拥有"，执行放弃流程 ===')

  // 点击放弃
  if (!findAndClickByTextVisible(/^放弃$/)) {
    LogFloaty.pushErrorLog('未找到"放弃"')
    return false
  }
  sleep(2000)

  // 点击"确定放弃"
  if (!findAndClickByTextVisible(/^确定放弃$/)) {
    LogFloaty.pushErrorLog('未找到"确定放弃"')
    return false
  }
  sleep(2000)
  return true
}

// 判断今日剩余次数是否为0（完全匹配"今日次数：N"，冒号后允许有空格）
function isTodayCountZero () {
  let result = widgetInspector.detectAllNodesVisible()
  for (let n of result.nodes) {
    if (n.text && /^今日次数：\s*\d+$/.test(n.text)) {
      let m = n.text.match(/今日次数：\s*(\d+)/)
      if (m && parseInt(m[1], 10) === 0) {
        taskLog('检测到"今日次数：0"，今日次数已用完')
        return true
      }
    }
  }
  return false
}

// 每天第一次进入神奇物种会自动抽取一张卡片，需手动点击"收下"；等待5s后点击，返回 false 不退出（可能不是第一次进入，无"收下"可点）
function collectFirstCard () {
  sleep(5000)
  findAndClickByTextVisible(/^收下$/)
  return false
}

// 检测并合成勋章：返回 true=已合成勋章任务完成应退出；false=无需合成继续后续流程；点击失败则异常退出
function synthesizeMedal () {
  let result = widgetInspector.detectAllNodesVisible()
  let hasSynthesize = result.nodes.some(function (n) {
    return n.text && (/你已经集齐.*/.test(n.text) || /^去合成$/.test(n.text))
  })

  if (!hasSynthesize) {
    taskLog('未检测到"你已经集齐"或"去合成"，继续后续流程')
    return false
  }

  taskLog('检测到需要合成勋章，点击"去合成"')
  if (!findAndClickByTextVisible(/^去合成$/)) {
    LogFloaty.pushErrorLog('未找到"去合成"，异常退出')
    exitScript()
    return false
  }

  // 等待"点击合成勋章"出现，超时2s
  widgetUtils.widgetWaiting('^点击合成勋章$', '点击合成勋章', 2000)
  sleep(4000)

  if (!findAndClickByTextVisible(/^点击合成勋章$/)) {
    LogFloaty.pushErrorLog('未找到"点击合成勋章"，异常退出')
    exitScript()
    return false
  }

  // 点击"确认"
  if (!findAndClickByTextVisible(/^确认$/)) {
    LogFloaty.pushErrorLog('未找到"确认"，异常退出')
    exitScript()
    return false
  }

  // 等待"关闭"出现（合成完成），超时5s，完全匹配
  widgetUtils.widgetWaiting('^关闭$', '关闭', 5000)
  sleep(4000)

  if (!findAndClickByTextVisible(/^关闭$/)) {
    LogFloaty.pushErrorLog('未找到"关闭"，异常退出')
    exitScript()
    return false
  }

  sleep(2000)
  taskLog('合成勋章完成，任务结束')
  return true
}

// 判断是否已集齐卡片：在"更多"与"抽卡截止日期.*"之间存在"数字/数字"且两数相等则已集齐
function checkCardCollected () {
  let result = widgetInspector.detectAllNodesVisible()
  let topAnchorY = null   // "更多" 的 centerY（上方锚点）
  let bottomAnchorY = null // "抽卡截止日期.*" 的 centerY（下方锚点）

  for (let n of result.nodes) {
    if (!n.text || !n.bounds) continue
    if (/^更多$/.test(n.text)) {
      topAnchorY = n.bounds.centerY()
    } else if (/抽卡截止日期.*/.test(n.text)) {
      bottomAnchorY = n.bounds.centerY()
    }
  }

  if (topAnchorY === null || bottomAnchorY === null) {
    taskLog('未找到"更多"或"抽卡截止日期.*"锚点，无法判断是否集齐')
    return false
  }

  taskLog('上方锚点Y=' + topAnchorY + '，下方锚点Y=' + bottomAnchorY)

  // 在两个锚点之间找"数字/数字"文本，且两数相等
  for (let n of result.nodes) {
    if (!n.text || !n.bounds) continue
    let y = n.bounds.centerY()
    if (y <= topAnchorY || y >= bottomAnchorY) continue // 只取两锚点之间
    let m = n.text.match(/^(\d+)\/(\d+)$/)
    if (m) {
      let a = parseInt(m[1], 10)
      let b = parseInt(m[2], 10)
      taskLog('检测到"' + n.text + '"（Y=' + y + '）')
      if (a === b) {
        taskLog('已集齐卡片（' + a + '/' + b + '），任务完成')
        return true
      }
    }
  }

  taskLog('未检测到已集齐（两数相等的"数字/数字"）')
  return false
}

// 主流程
function main () {
  taskLog('========== 神奇物种 开始 ==========')

  // 进入神奇物种
  if (!openMagicSpecies()) {
    LogFloaty.pushErrorLog('无法进入神奇物种')
    return false
  }

  // 检测并合成勋章；返回 true 表示已合成勋章，任务完成直接退出，不再执行后续交换流程
  if (synthesizeMedal()) {
    exitScript()
  }
  // 返回 false 表示无需合成，继续正常抽卡交换流程

  // 判断是否已集齐卡片；已集齐则直接退出，不再执行后续任务
  if (checkCardCollected()) {
    taskLog('已集齐卡片，任务完成')
    exitScript()
  }

  // 第一次进入：点击"抽好友卡片"进入好友的卡页面（openMagicSpecies 内部已确认在神奇物种页面）
  if (!findAndClickByTextVisible(/^抽好友卡片$/)) {
    LogFloaty.pushErrorLog('未找到"抽好友卡片"')
    return false
  }
  sleep(2000)

  // 循环抽卡，直到今日次数为0（每轮处理完结果后都会回到好友的卡页面）
  while (true) {
    // 判断是否在好友的卡页面，不在则返回重进
    if (!isOnFriendCardPage()) {
      taskLog('不在好友的卡页面，返回重进')
      goBack()
      if (!isOnMagicSpeciesPage()) {
        taskLog('返回后不在神奇物种页面，重新进入')
        if (!openMagicSpecies()) {
          return false
        }
      }
      sleep(1000)
      if (!findAndClickByTextVisible(/^抽好友卡片$/)) {
        LogFloaty.pushErrorLog('重进后未找到"抽好友卡片"')
        return false
      }
      sleep(2000)
      if (!isOnFriendCardPage()) {
        LogFloaty.pushErrorLog('重进后仍未进入好友的卡页面')
        return false
      }
    }

    // 进入好友的卡页面后，判断今日次数是否为0（"今日次数"文本在此页面出现），是则退出循环
    if (isTodayCountZero()) {
      taskLog('今日次数已用完，退出循环')
      break
    }

    // 点击"点击抽卡"
    if (!findAndClickByTextVisible(/^点击抽卡$/)) {
      LogFloaty.pushErrorLog('未找到"点击抽卡"')
      return false
    }
    widgetUtils.widgetWaiting('^放弃$', '抽卡结果', 5000) // 等待"放弃"出现（完全匹配），总延时5s
    sleep(4000)

    // 检查抽卡结果
    let allNodes = widgetInspector.detectAllNodesVisible().nodes
    let hasNotOwned = allNodes.some(function (n) { return /你还未拥有此物种卡/.test(n.text) })
    let hasOwned = allNodes.some(function (n) { return /你已拥有：\d+张/.test(n.text) })

    if (hasNotOwned) {
      // 未拥有：执行交换流程
      if (!doExchangeFlow()) {
        LogFloaty.pushErrorLog('交换流程失败')
        return false
      }
    } else if (hasOwned) {
      // 已拥有：执行放弃流程
      if (!doGiveUpFlow()) {
        LogFloaty.pushErrorLog('放弃流程失败')
        return false
      }
    } else {
      taskLog('未检测到抽卡结果，退出循环')
      break
    }

    // 循环继续（处理完结果后已回到好友的卡页面）
    taskLog('=== 继续下一轮抽卡 ===')
    sleep(2000)
  }

  taskLog('========== 神奇物种 完成 ==========')
  return true
}

// 退出脚本：返回桌面并清理运行状态
function exitScript () {
  commonFunction.minimize()
  sleep(500)
  killApps()
  sleep(500)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

// ============================================================
// 执行入口
// ============================================================

if (executeByTimeTask) {
  // 自动模式
  taskLog('自动模式：开始神奇物种')
  main()
  taskLog('任务完成')
  exitScript()
} else {
  // 手动模式：直接执行
  commonFunction.registerOnEngineRemoved(function () {
    runningQueueDispatcher.removeRunningTask()
  })
  main()
  taskLog('任务完成')
  exitScript()
}
