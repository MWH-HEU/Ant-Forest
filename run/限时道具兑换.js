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

// 是否启用能量雨次卡兑换（默认启用）
const ENABLE_ENERGY_RAIN_EXCHANGE = true

// 是否启用能量保护罩兑换（默认启用）
const ENABLE_PROTECTOR_EXCHANGE = true

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

// 返回上一页
function goBack () {
  back()
  sleep(2000)
}

// OCR查找并点击指定文字（在指定超时内循环截图识别，找到即点击）
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
        sleep(1000)
        return true
      }
    }
    sleep(1000)
  }
  return false
}

// 进入蚂蚁森林
function enterAntForest () {
  taskLog('进入蚂蚁森林')

  commonFunction.backHomeIfInVideoPackage()

  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=60000002',
    packageName: config.package_name
  })

  let confirm = widgetUtils.widgetGetOne(/^打开$/, 1000)
  if (confirm) {
    automator.clickCenter(confirm)
  }

  commonFunction.readyForAlipayWidgets()

  let waitCount = 0
  while (!widgetUtils.homePageWaiting() && waitCount++ < 10) {
    sleep(1000)
  }

  // while 退出后，waitCount >= 10 说明超时未进入首页
  if (waitCount >= 10) {
    errorInfo('进入蚂蚁森林失败')
    return false
  }
  taskLog('进入蚂蚁森林成功')
  return true
}

// 进入背包：优先模板匹配backpack_icon，失败时OCR兜底（需确保已在蚂蚁森林首页）
function enterBackpack () {
  taskLog('点击"背包"进入背包')
  sleep(1000)

  // 方案1：模板图片匹配（优先）
  if (config.image_config && config.image_config.backpack_icon) {
    try {
      let screen = commonFunction.captureScreen()
      if (screen) {
        let match = OpenCvUtil.findByGrayBase64(screen, config.image_config.backpack_icon, false)
        screen.recycle()
        if (match) {
          let centerX = Math.round(match.centerX())
          let centerY = Math.round(match.centerY())
          taskLog('模板匹配找到"背包": 点击: (' + centerX + ', ' + centerY + ')')
          automator.click(centerX, centerY)
          sleep(1000)
          return true
        }
        taskLog('模板匹配未找到"背包"，回退到OCR')
      } else {
        taskLog('截屏失败，回退到OCR')
      }
    } catch (e) {
      taskLog('模板匹配异常: ' + e + '，回退到OCR')
    }
  } else {
    taskLog('未配置backpack_icon模板，使用OCR')
  }

  // 方案2：OCR识别（兜底）
  if (!clickByOcr('背包', 5000)) {
    LogFloaty.pushErrorLog('OCR未找到背包入口')
    return false
  }
  return true
}

// 关闭背包：用detectAllNodesVisible查找可点击的Button类型且文本完全匹配"关闭"的按钮并点击
function closeBackpack () {
  sleep(1000)

  let allNodes = widgetInspector.detectAllNodesVisible().nodes

  // 查找可点击的Button类型且文本完全匹配"关闭"的按钮
  for (let n of allNodes) {
    if (n.text === '关闭' && n.clickable && n.className === 'android.widget.Button' && n.bounds) {
      taskLog('找到可点击的"关闭"按钮，点击: (' + n.bounds.centerX() + ', ' + n.bounds.centerY() + ')')
      automator.click(n.bounds.centerX(), n.bounds.centerY())
      sleep(2000)
      return true
    }
  }

  LogFloaty.pushErrorLog('未找到可点击的"关闭"按钮')
  return false
}

// 判断是否在蚂蚁森林界面（需同时找到"蚂蚁森林"和"森林广场"）
function isOnAntForestPage () {
  let result = widgetUtils.widgetWaiting('蚂蚁森林', '蚂蚁森林首页', 3000)
  if (!result) {
    taskLog('未检测到"蚂蚁森林"，不在蚂蚁森林界面')
    return false
  }
  let squareResult = widgetUtils.widgetWaiting('森林广场', '蚂蚁森林首页', 3000)
  if (!squareResult) {
    taskLog('未检测到"森林广场"，不在蚂蚁森林界面')
    return false
  }
  taskLog('检测到"蚂蚁森林"和"森林广场"，确认在蚂蚁森林界面')
  return true
}

// 判断是否在背包界面（需同时找到"道具 伙伴 套装 皮肤 挂件 背景"）
function isOnBackpackPage () {
  let texts = ['道具', '伙伴', '套装', '皮肤', '挂件', '背景']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], '背包页面', 3000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在背包界面')
      return false
    }
  }
  taskLog('检测到"道具 伙伴 套装 皮肤 挂件 背景"，确认在背包界面')
  return true
}

// 关闭背包后重新进入背包，并点击"活力值积分商店"
function clickExchangeWithVitality () {
  // 关闭当前背包页面
  if (!closeBackpack()) {
    return false
  }

  // 判断是否在蚂蚁森林界面，不在则先进入蚂蚁森林
  if (!isOnAntForestPage()) {
    if (!enterAntForest()) {
      return false
    }
  }
  sleep(2000)

  // 通过模板匹配/OCR点击"背包"进入背包
  if (!enterBackpack()) {
    return false
  }

  // 判断是否已进入背包界面
  if (!isOnBackpackPage()) {
    LogFloaty.pushErrorLog('未进入背包界面')
    return false
  }
  sleep(2000)

  if (!findAndClickByTextVisible(/活力值积分商店/)) {
    LogFloaty.pushErrorLog('未找到"活力值积分商店"')
    return false
  }

  sleep(2000)
  return true
}



// 点击"能量雨次卡"，检查是否已达上限
function clickEnergyRainCard () {
  sleep(1000)

  if (!findAndClickByTextVisible(/能量雨次卡/)) {
    LogFloaty.pushErrorLog('未找到"能量雨次卡"卡片')
    return false
  }

  sleep(2000)

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
  sleep(1000)

  if (!findAndClickByTextVisible(/立即兑换/)) {
    LogFloaty.pushErrorLog('未找到"立即兑换"按钮')
    return false
  }
  sleep(2000)

  if (!findAndClickByTextVisible(/确认兑换/)) {
    LogFloaty.pushErrorLog('未找到"确认兑换"按钮')
    return false
  }
  sleep(2000)

  if (!findAndClickByTextVisible(/立即使用/)) {
    LogFloaty.pushErrorLog('未找到"立即使用"按钮')
    return false
  }

  // 判断是否已回到背包界面，不在则重新进入蚂蚁森林并进背包
  if (!isOnBackpackPage()) {
    taskLog('未回到背包界面，重新进入蚂蚁森林并进背包')
    if (!enterAntForest()) {
      return false
    }
    // 判断是否在蚂蚁森林界面
    if (!isOnAntForestPage()) {
      return false
    }
    sleep(2000)
    if (!enterBackpack()) {
      LogFloaty.pushErrorLog('重新进入背包失败')
      return false
    }
    // 判断是否已进入背包界面
    if (!isOnBackpackPage()) {
      LogFloaty.pushErrorLog('重新进入背包后未在背包界面')
      return false
    }
    sleep(2000)
  }

  return true
}

// 在背包中查找匹配正则的TextView卡片，找同列可点击的"使用"按钮并点击（检测"没有更多了"停止滑动）
function findAndUseCard (pattern) {
  sleep(1000)

  while (true) {
    let allNodes = widgetInspector.detectAllNodesVisible().nodes

    // 匹配所有符合条件的TextView卡片
    let cardNodes = allNodes.filter(function (n) {
      return n.text && n.className === 'android.widget.TextView' && pattern.test(n.text) && n.bounds
    })

    // 遍历所有匹配的卡片，找同列可点击的"使用"按钮（X坐标完全一样，卡片在按钮上方且差值<200）
    for (let ci = 0; ci < cardNodes.length; ci++) {
      let cardNode = cardNodes[ci]
      let useNode = allNodes.find(function (n) {
        return n.text === '使用' && n.clickable && n.bounds &&
          n.bounds.centerX() === cardNode.bounds.centerX() &&
          cardNode.bounds.centerY() < n.bounds.centerY() &&
          Math.abs(n.bounds.centerY() - cardNode.bounds.centerY()) < 200
      })

      if (useNode) {
        automator.click(useNode.bounds.centerX(), useNode.bounds.centerY())
        sleep(2000)
        return true
      }
    }

    // 检查是否已到底部
    let hasEnd = allNodes.some(function (n) { return /没有更多了/.test(n.text) })
    if (hasEnd) {
      break
    }

    automator.randomScrollDown()
    sleep(1000)
  }

  sleep(2000)
  LogFloaty.pushErrorLog('未找到卡片，可能已使用完或不存在')
  return false
}

// 智能关闭弹窗：先找同列的关闭按钮；找不到时用OCR识别"X"；OCR仍失败则返回键退出弹窗并重新检测背包界面（在则进活力值积分商店）；关闭失败或未找到活力值积分商店时返回false，由调用处决定是否退出脚本
function smartClosePopup () {
  sleep(1000)

  let allNodes = widgetInspector.detectAllNodesVisible().nodes

  // 找到完全匹配"关闭"的控件（仅用于获取x坐标，不点击它）
  let closeLabel = null
  for (let n of allNodes) {
    if (n.text === '关闭' && n.bounds) {
      closeLabel = n
      break
    }
  }

  if (closeLabel) {
    let closeX = closeLabel.bounds.centerX()

    // 找所有可点击的按钮，x坐标与"关闭"相差小于50，但排除文本为"关闭"的按钮
    for (let n of allNodes) {
      if (n.clickable && n.bounds && n.text !== '关闭' && Math.abs(n.bounds.centerX() - closeX) < 50) {
        taskLog('找到关闭按钮: "' + n.text + '"，点击: (' + n.bounds.centerX() + ', ' + n.bounds.centerY() + ')')
        automator.click(n.bounds.centerX(), n.bounds.centerY())
        sleep(1000)
        return true
      }
    }
  }

  // 兜底：OCR识别"X"；识别不到则返回键退出弹窗，再重新检测背包界面
  taskLog('未找到关闭按钮，尝试OCR识别X')
  if (clickByOcr('X', 2000)) {
    sleep(1000)
    return true
  }

  // OCR未识别到X，改用返回键退出弹窗
  taskLog('OCR未识别到X，改用返回键退出弹窗')
  goBack()

  // 重新检测是否在背包界面
  if (isOnBackpackPage()) {
    taskLog('返回后仍在背包界面，进入活力值积分商店')
    if (findAndClickByTextVisible(/活力值积分商店/)) {
      sleep(2000)
      return true
    }
    LogFloaty.pushErrorLog('返回后未找到"活力值积分商店"')
    return false
  }

  // 不在背包界面，返回false（由调用处决定是否退出脚本）
  taskLog('返回后不在背包界面，关闭弹窗失败')
  LogFloaty.pushErrorLog('关闭弹窗失败且不在背包界面')
  return false
}

// 点击使用后处理"确认延长"弹窗（保护罩特有）
function handleExtendPopup () {
  sleep(1000)
  if (findAndClickByTextVisible(/确认延长/)) {
    taskLog('已点击"确认延长"')
    sleep(2000)
    return true
  }
  return false
}

// 在活力值积分商店中遍历保护罩卡片进行兑换（检测"没有更多了"停止滑动）
function exchangeProtectorCard () {
  sleep(1000)

  while (true) {
    let allNodes = widgetInspector.detectAllNodesVisible().nodes

    // 找出当前可见的所有保护罩卡片
    let cardNodes = allNodes.filter(function (n) { return /保护罩/.test(n.text) && n.bounds })

    if (cardNodes.length > 0) {
      for (let ci = 0; ci < cardNodes.length; ci++) {
        let cardNode = cardNodes[ci]
        taskLog('尝试兑换: "' + cardNode.text + '"')
        automator.click(cardNode.bounds.centerX(), cardNode.bounds.centerY())
        sleep(2000)

        // 先点击"限时3天内使用"（如果有这个选项），触发库存不足/已达上限判断
        findAndClickByTextVisible(/限时3天内使用/)
        sleep(1000)

        // 检查是否弹出"库存不足"或"已达上限"
        let checkResult = widgetInspector.detectAllNodesVisible()
        let hasOutOfStock = checkResult.nodes.some(function (n) { return /库存不足/.test(n.text) })
        let hasAlreadyExchanged = checkResult.nodes.some(function (n) { return /已达上限/.test(n.text) })

        if (hasOutOfStock) {
          taskLog('"' + cardNode.text + '"库存不足，尝试下一个')
          if (!smartClosePopup()) {
            exitScript()
          }
          continue
        }

        if (hasAlreadyExchanged) {
          taskLog('已达上限，跳过兑换')
          if (!smartClosePopup()) {
            exitScript()
          }
          return 'already_exchanged'
        }

        // 点击"立即兑换"
        if (!findAndClickByTextVisible(/立即兑换/)) {
          taskLog('未找到"立即兑换"，尝试下一个保护罩')
          if (!smartClosePopup()) {
            exitScript()
          }
          continue
        }
        sleep(2000)

        // 确认兑换流程
        taskLog('兑换成功，执行确认兑换')
        if (!findAndClickByTextVisible(/确认兑换/)) {
          LogFloaty.pushErrorLog('未找到"确认兑换"按钮')
          return false
        }
        sleep(2000)

        if (!findAndClickByTextVisible(/立即使用/)) {
          LogFloaty.pushErrorLog('未找到"立即使用"按钮')
          return false
        }

        // 判断是否已回到背包界面，不在则重新进入蚂蚁森林并进背包
        if (!isOnBackpackPage()) {
          taskLog('保护罩：未回到背包界面，重新进入蚂蚁森林并进背包')
          if (!enterAntForest()) {
            return false
          }
          // 判断是否在蚂蚁森林界面
          if (!isOnAntForestPage()) {
            return false
          }
          sleep(2000)
          if (!enterBackpack()) {
            LogFloaty.pushErrorLog('保护罩：重新进入背包失败')
            return false
          }
          // 判断是否已进入背包界面
          if (!isOnBackpackPage()) {
            LogFloaty.pushErrorLog('保护罩：重新进入背包后未在背包界面')
            return false
          }
          sleep(2000)
        }
        sleep(2000)

        taskLog('=== 在背包中查找并使用保护罩 ===')
        if (!findAndUseCard(/.*保护罩.*共\d+个.*使用/)) {
          LogFloaty.pushErrorLog('保护罩：未找到保护罩卡片')
          return false
        }
        if (!clickUseNow()) {
          LogFloaty.pushErrorLog('保护罩：点击立即使用失败')
          return false
        }

        // 保护罩使用后可能有"确认延长"弹窗
        handleExtendPopup()

        return true
      }
    }

    // 当前页面没有保护罩卡片，检查是否已到底部
    let hasEnd = allNodes.some(function (n) { return /没有更多了/.test(n.text) })
    if (hasEnd) {
      break
    }

    automator.randomScrollDown()
    sleep(1000)
  }

  LogFloaty.pushErrorLog('所有保护罩卡片兑换失败（库存不足或未找到）')
  return false
}

// 点击"立即使用"弹窗
function clickUseNow () {
  sleep(1000)

  if (!findAndClickByTextVisible(/立即使用/)) {
    LogFloaty.pushErrorLog('未找到"立即使用"按钮')
    return false
  }

  sleep(2000)
  return true
}

// 能量雨次卡流程
function doEnergyRainExchange () {
  taskLog('========== 能量雨次卡 开始 ==========')

  taskLog('=== 进入蚂蚁森林并进入背包 ===')
  if (!enterAntForest()) {
    LogFloaty.pushErrorLog('能量雨：无法进入蚂蚁森林')
    return false
  }
  // 判断是否在蚂蚁森林界面
  if (!isOnAntForestPage()) {
    return false
  }
  sleep(2000)
  if (!enterBackpack()) {
    LogFloaty.pushErrorLog('能量雨：无法进入背包页面')
    return false
  }
  // 判断是否已进入背包界面
  if (!isOnBackpackPage()) {
    LogFloaty.pushErrorLog('能量雨：未在背包界面')
    return false
  }
  sleep(2000)

  taskLog('=== 检查背包中是否有已有能量雨卡片 ===')
  let hasRainCard = findAndUseCard(/.*能量雨.*共\d+个.*使用/)

  if (hasRainCard) {
    taskLog('=== 点击"立即使用" ===')
    if (!clickUseNow()) {
      LogFloaty.pushErrorLog('能量雨：点击立即使用失败')
      return false
    }
    taskLog('能量雨次卡已成功使用！')
    return true
  }

  taskLog('背包中未找到能量雨机会卡片，开始兑换流程')

  taskLog('=== 重新进入背包并点击"活力值积分商店" ===')
  if (!clickExchangeWithVitality()) {
    LogFloaty.pushErrorLog('能量雨：无法进入活力值积分商店页面')
    return false
  }

  taskLog('=== 点击能量雨次卡的"兑换" ===')
  let cardResult = clickEnergyRainCard()
  if (cardResult === 'already_exchanged') {
    taskLog('能量雨次卡已达上限，跳过兑换')
    return true
  } else if (!cardResult) {
    LogFloaty.pushErrorLog('能量雨：无法点击能量雨次卡的兑换')
    return false
  } else {
    taskLog('=== 兑换并立即使用 ===')
    if (!confirmExchange()) {
      LogFloaty.pushErrorLog('能量雨：兑换流程异常')
      return false
    }
    taskLog('=== 在背包中查找并使用能量雨机会 ===')
    if (!findAndUseCard(/.*能量雨.*共\d+个.*使用/)) {
      LogFloaty.pushErrorLog('能量雨：未找到能量雨机会卡片')
      return false
    }
    if (!clickUseNow()) {
      LogFloaty.pushErrorLog('能量雨：点击立即使用失败')
      return false
    }
    taskLog('能量雨次卡已成功使用！')
    return true
  }
}

// 能量保护罩流程
function doProtectorExchange () {
  taskLog('========== 能量保护罩 开始 ==========')

  taskLog('=== 进入蚂蚁森林并进入背包 ===')
  if (!enterAntForest()) {
    LogFloaty.pushErrorLog('保护罩：无法进入蚂蚁森林')
    return false
  }
  // 判断是否在蚂蚁森林界面
  if (!isOnAntForestPage()) {
    return false
  }
  sleep(2000)
  if (!enterBackpack()) {
    LogFloaty.pushErrorLog('保护罩：无法进入背包页面')
    return false
  }
  // 判断是否已进入背包界面
  if (!isOnBackpackPage()) {
    LogFloaty.pushErrorLog('保护罩：未在背包界面')
    return false
  }
  sleep(2000)

  taskLog('=== 检查背包中是否有已有保护罩卡片 ===')
  let hasProtectorCard = findAndUseCard(/.*保护罩.*共\d+个.*使用/)

  if (hasProtectorCard) {
    taskLog('=== 点击"立即使用" ===')
    if (!clickUseNow()) {
      LogFloaty.pushErrorLog('保护罩：点击立即使用失败')
      return false
    }
    // 保护罩使用后可能有"确认延长"弹窗
    handleExtendPopup()
    taskLog('保护罩已成功使用！')
    return true
  }

  taskLog('背包中未找到保护罩卡片，开始兑换流程')

  taskLog('=== 重新进入背包并点击"活力值积分商店" ===')
  if (!clickExchangeWithVitality()) {
    LogFloaty.pushErrorLog('保护罩：无法进入活力值积分商店页面')
    return false
  }

  taskLog('=== 遍历兑换保护罩卡片 ===')
  let protectorResult = exchangeProtectorCard()

  if (protectorResult === 'already_exchanged') {
    taskLog('保护罩已达上限，跳过兑换')
    return true
  } else if (!protectorResult) {
    LogFloaty.pushErrorLog('保护罩：所有卡片兑换失败')
    return false
  } else {
    taskLog('保护罩已成功使用！')
    return true
  }
}

// 主流程
function main () {
  taskLog('========== 限时道具兑换 开始 ==========')

  if (ENABLE_ENERGY_RAIN_EXCHANGE) {
    doEnergyRainExchange()
  }

  if (ENABLE_PROTECTOR_EXCHANGE) {
    doProtectorExchange()
  }

  taskLog('========== 限时道具兑换 完成 ==========')
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
  taskLog('自动模式：开始限时道具兑换')
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
