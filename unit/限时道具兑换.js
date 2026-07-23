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
let killProcessUtil = require('../lib/KillProcessUtil.js')
let widgetInspector = require('../lib/WidgetInspector.js')(runtime, global)

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

let executeArguments = config.parseExecArgv()
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
// 核心逻辑：限时道具兑换
// ============================================================

// 等待弹窗稳定
function waitPopupStable (ms) {
  sleep(ms || 2000)
}

// 遍历所有控件，正则匹配文本并点击（参考复活能量 findAndClickByText）
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

// 遍历可见区域内的控件，正则匹配文本并点击（参考复活能量 findAndClickByTextVisible）
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

// OCR查找并点击指定文字（仅步骤1使用）
function clickByOcr (keyword, timeout) {
  if (!localOcrUtil.enabled) return false
  let deadline = new Date().getTime() + (timeout || 3000)
  while (new Date().getTime() < deadline) {
    commonFunction.requestScreenCaptureOrRestart()
    sleep(300)
    let screen = commonFunction.captureScreen()
    if (screen) {
      let results = localOcrUtil.recognizeWithBounds(screen, null, keyword)
      screen.recycle()
      if (results && results.length > 0) {
        let match = results[0]
        taskLog('OCR找到"' + keyword + '"，点击: (' + match.bounds.centerX() + ', ' + match.bounds.centerY() + ')')
        automator.click(match.bounds.centerX(), match.bounds.centerY())
        sleep(500)
        return true
      }
    }
    sleep(500)
  }
  return false
}

// 打开蚂蚁森林并进入背包（仅用OCR查找"背包"）
function openBackpack () {
  commonFunction.backHomeIfInVideoPackage()
  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=60000002',
    packageName: config.package_name
  })
  let confirm = widgetUtils.widgetGetOne(/^打开$/, 2000)
  if (confirm) {
    automator.clickCenter(confirm)
  }
  sleep(1000)
  widgetUtils.widgetWaiting('.*(蚂蚁森林|森林|收集能量|浇水|去保护|找能量|森林广场).*', 3000)
  sleep(3000)

  if (!clickByOcr('背包', 5000)) {
    LogFloaty.pushErrorLog('OCR未找到背包入口')
    return false
  }

  waitPopupStable(500)
  return true
}

// 重新进入背包后点击"活力值积分商店"
function clickExchangeWithVitality () {
  // 先重新打开蚂蚁森林并进入背包，确保页面状态干净
  if (!openBackpack()) {
    return false
  }

  if (!findAndClickByText(/活力值积分商店/)) {
    LogFloaty.pushErrorLog('未找到"活力值积分商店"')
    return false
  }

  sleep(500)
  waitPopupStable(500)
  return true
}



// 点击"能量雨次卡"，检查是否已达上限
function clickEnergyRainCard () {
  waitPopupStable(500)

  if (!findAndClickByText(/能量雨次卡/)) {
    LogFloaty.pushErrorLog('未找到"能量雨次卡"卡片')
    return false
  }

  waitPopupStable(500)

  // 点击后检查是否弹出"已达上限"（每天已兑换过）
  let checkResult = widgetInspector.detectAllNodesVisible()
  let alreadyExchanged = checkResult.nodes.some(function (n) { return /已达上限/.test(n.text) })

  if (alreadyExchanged) {
    return 'already_exchanged'
  }

  return true
}

// 兑换确认流程：立即兑换 -> 确认兑换 -> 立即使用
function confirmExchange () {
  waitPopupStable(500)

  if (!findAndClickByText(/立即兑换/)) {
    LogFloaty.pushErrorLog('未找到"立即兑换"按钮')
    return false
  }
  waitPopupStable(500)

  if (!findAndClickByText(/确认兑换/)) {
    LogFloaty.pushErrorLog('未找到"确认兑换"按钮')
    return false
  }
  waitPopupStable(500)

  if (!findAndClickByText(/立即使用/)) {
    LogFloaty.pushErrorLog('未找到"立即使用"按钮')
    return false
  }
  waitPopupStable(500)

  return true
}

// 在背包中查找"限时能量雨机会"卡片上的"使用"按钮并点击（带滑动重试）
function findAndUseEnergyRainCard () {
  waitPopupStable(500)

  let found = false
  let maxScrollAttempts = 3
  let scrollAttempt = 0

  while (!found && scrollAttempt < maxScrollAttempts) {
    if (scrollAttempt > 0) {
      automator.randomScrollDown()
      sleep(1000)
    }

    let allNodes = widgetInspector.detectAllNodesVisible().nodes

    let cardNode = allNodes.find(function (n) { return /限时能量雨机会/.test(n.text) && !/使用了/.test(n.text) })
    if (!cardNode || !cardNode.bounds) {
      scrollAttempt++
      continue
    }

    let useNode = allNodes.find(function (n) {
      return /^使用$/.test(n.text) && n.bounds && Math.abs(n.bounds.centerY() - cardNode.bounds.centerY()) < 300
    })

    if (useNode) {
      automator.click(useNode.bounds.centerX(), useNode.bounds.centerY())
      sleep(500)
      found = true
      break
    }

    scrollAttempt++
  }

  if (!found) {
    LogFloaty.pushErrorLog('未找到"限时能量雨机会"卡片，可能已使用完或不存在')
    return false
  }

  waitPopupStable(500)
  return true
}

// 点击"立即使用"弹窗
function clickUseNow () {
  waitPopupStable(500)

  if (!findAndClickByText(/立即使用/)) {
    LogFloaty.pushErrorLog('未找到"立即使用"按钮')
    return false
  }

  waitPopupStable(500)
  return true
}

// 主流程
function main () {
  taskLog('========== 限时道具兑换 开始 ==========')

  // 打开蚂蚁森林 -> 背包
  taskLog('=== 打开蚂蚁森林并进入背包 ===')
  if (!openBackpack()) {
    LogFloaty.pushErrorLog('步骤1失败：无法进入背包页面')
    return false
  }

  // 检查背包中是否有已有卡片
  // 如果有则直接使用，跳过兑换流程
  taskLog('=== 检查背包中是否有已有卡片 ===')
  let hasCard = findAndUseEnergyRainCard()

  if (hasCard) {
    taskLog('=== 点击"立即使用" ===')
    if (!clickUseNow()) {
      LogFloaty.pushErrorLog('步骤3失败：无法点击立即使用')
      return false
    }
    taskLog('能量雨次卡已成功使用！')
    taskLog('========== 限时道具兑换 完成 ==========')
    return true
  }

  // 背包中没有，走兑换流程
  taskLog('背包中未找到能量雨机会卡片，开始兑换流程')

  // 重新进入背包后点击"活力值积分商店"
  taskLog('=== 重新进入背包并点击"活力值积分商店" ===')
  if (!clickExchangeWithVitality()) {
    LogFloaty.pushErrorLog('步骤3失败：无法进入活力值积分商店页面')
    return false
  }

  // 点击"能量雨次卡"
  taskLog('=== 点击能量雨次卡的"兑换" ===')
  let cardResult = clickEnergyRainCard()
  if (cardResult === 'already_exchanged') {
    taskLog('已达上限，跳过兑换步骤，直接去背包使用')
    taskLog('=== 重新打开蚂蚁森林并进入背包 ===')
    if (!openBackpack()) {
      LogFloaty.pushErrorLog('重新打开背包失败')
      return false
    }
  } else if (!cardResult) {
    LogFloaty.pushErrorLog('步骤4失败：无法点击能量雨次卡的兑换')
    return false
  } else {
    // 步骤5：立即兑换 -> 确认兑换 -> 立即使用
    taskLog('=== 兑换并立即使用 ===')
    if (!confirmExchange()) {
      LogFloaty.pushErrorLog('步骤5失败：兑换流程异常')
      return false
    }
  }

  // 查找能量雨机会并点击"使用"
  taskLog('=== 在背包中查找并使用能量雨机会 ===')
  if (!findAndUseEnergyRainCard()) {
    LogFloaty.pushErrorLog('步骤6失败：未找到能量雨机会卡片')
    return false
  }

  // 点击"立即使用"
  taskLog('=== 点击"立即使用" ===')
  if (!clickUseNow()) {
    LogFloaty.pushErrorLog('步骤7失败：无法点击立即使用')
    return false
  }
  taskLog('能量雨次卡已成功使用！')

  taskLog('========== 限时道具兑换 完成 ==========')
  return true
}

// 退出：返回桌面
function cleanUpAndExit () {
  taskLog('任务完成，返回桌面')
  commonFunction.minimize()
  sleep(500)
  // 杀掉后台进程
  killApps()
  exit()
}

// ============================================================
// 执行入口
// ============================================================

if (executeByTimeTask) {
  // 自动模式
  taskLog('自动模式：开始限时道具兑换')
  main()
  taskLog('任务完成')
  cleanUpAndExit()
} else {
  // 手动模式：直接执行
  commonFunction.registerOnEngineRemoved(function () {
    runningQueueDispatcher.removeRunningTask()
  })
  main()
  taskLog('任务完成')
  cleanUpAndExit()
}
