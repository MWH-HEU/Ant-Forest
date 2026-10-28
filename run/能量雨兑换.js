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
// 核心逻辑：能量雨兑换
// ============================================================

// 遍历所有控件（含不可见的），正则匹配文本并点击（参考复活能量 findAndClickByText）
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

// 可见控件中是否存在匹配文本（不点击），用于版本判断
function existsVisibleText (pattern) {
  let result = widgetInspector.detectAllNodesVisible()
  for (let node of result.nodes) {
    if (node.text && pattern.test(node.text)) return true
  }
  return false
}

// 返回上一页
function goBack () {
  back()
  sleep(4000)
}

// OCR查找并点击指定文字（在指定超时内循环截图识别，找到即点击）
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
        sleep(2000)
        return true
      }
    }
    sleep(2000)
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

  let confirm = widgetUtils.widgetGetOne(/^打开$/, 10000)
  if (confirm) {
    automator.clickCenter(confirm)
  }


  let waitCount = 0
  while (!widgetUtils.homePageWaiting() && waitCount++ < 10) {
    sleep(2000)
  }

  // while 退出后，waitCount >= 10 说明超时未进入首页
  if (waitCount >= 6) {
    errorInfo('进入蚂蚁森林失败')
    return false
  }
  taskLog('进入蚂蚁森林成功')
  return true
}

// 进入背包：优先模板匹配backpack_icon，失败时OCR兜底（需确保已在蚂蚁森林首页）
function enterBackpack () {
  taskLog('点击"背包"进入背包')
  sleep(2000)

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
          sleep(2000)
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
  if (!clickByOcr('背包', 10000)) {
    LogFloaty.pushErrorLog('OCR未找到背包入口')
    return false
  }
  return true
}

// 关闭背包：用detectAllNodesVisible查找可点击的Button类型且文本完全匹配"关闭"的按钮并点击
function closeBackpack () {
  sleep(2000)

  let allNodes = widgetInspector.detectAllNodesVisible().nodes

  // 查找可点击的Button类型且文本完全匹配"关闭"的按钮
  for (let n of allNodes) {
    if (n.text === '关闭' && n.clickable && n.className === 'android.widget.Button' && n.bounds) {
      taskLog('找到可点击的"关闭"按钮，点击: (' + n.bounds.centerX() + ', ' + n.bounds.centerY() + ')')
      automator.click(n.bounds.centerX(), n.bounds.centerY())
      sleep(3000)
      return true
    }
  }

  LogFloaty.pushErrorLog('未找到可点击的"关闭"按钮')
  return false
}

// 判断是否在蚂蚁森林界面（需同时找到"蚂蚁森林"和"森林广场"）
function isOnAntForestPage () {
  let result = widgetUtils.widgetWaiting('蚂蚁森林', '蚂蚁森林首页', 10000)
  if (!result) {
    taskLog('未检测到"蚂蚁森林"，不在蚂蚁森林界面')
    return false
  }
  let squareResult = widgetUtils.widgetWaiting('森林广场', '蚂蚁森林首页', 10000)
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
    let result = widgetUtils.widgetWaiting(texts[i], '背包页面', 10000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在背包界面')
      return false
    }
  }
  taskLog('检测到"道具 伙伴 套装 皮肤 挂件 背景"，确认在背包界面')
  return true
}

// 判断是否在活力值积分商店（需同时找到"活力值兑换""获取更多活力值""推荐"，完全匹配）
function isOnVitalityShopPage () {
  let texts = ['活力值兑换', '获取更多活力值', '推荐']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting('^' + texts[i] + '$', texts[i], 10000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在活力值积分商店')
      return false
    }
  }
  taskLog('检测到"活力值兑换 获取更多活力值 推荐"，确认在活力值积分商店')
  return true
}

// 兜底方案：enterVitalityShopByScrollUp 上滑进入商店失败时调用（关闭背包后重新进入背包，并点击"活力值积分商店"）
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
  sleep(4000)

  // 通过模板匹配/OCR点击"背包"进入背包
  if (!enterBackpack()) {
    return false
  }

  // 判断是否已进入背包界面
  if (!isOnBackpackPage()) {
    LogFloaty.pushErrorLog('未进入背包界面')
    return false
  }
  sleep(4000)

  if (!findAndClickByTextVisible(/活力值积分商店/)) {
    LogFloaty.pushErrorLog('未找到"活力值积分商店"')
    return false
  }
  sleep(4000)

  // 判断是否已进入活力值积分商店
  if (!isOnVitalityShopPage()) {
    LogFloaty.pushErrorLog('未进入活力值积分商店')
    return false
  }
  sleep(4000)
  return true
}



// 点击"能量雨次卡"，检查是否已达上限
function clickEnergyRainCard () {
  sleep(2000)

  if (!findAndClickByTextVisible(/能量雨次卡/)) {
    LogFloaty.pushErrorLog('未找到"能量雨次卡"卡片')
    return false
  }

  sleep(4000)

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
  sleep(2000)

  if (!findAndClickByTextVisible(/立即兑换/)) {
    LogFloaty.pushErrorLog('未找到"立即兑换"按钮')
    return false
  }
  sleep(4000)

  if (!findAndClickByTextVisible(/确认兑换/)) {
    LogFloaty.pushErrorLog('未找到"确认兑换"按钮')
    return false
  }
  sleep(4000)

  if (!findAndClickByTextVisible(/立即使用/)) {
    LogFloaty.pushErrorLog('未找到"立即使用"按钮')
    return false
  }

  // 点击立即使用后等待4s，再判断是否已回到背包界面
  sleep(4000)

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
    sleep(4000)
    if (!enterBackpack()) {
      LogFloaty.pushErrorLog('重新进入背包失败')
      return false
    }
    // 判断是否已进入背包界面
    if (!isOnBackpackPage()) {
      LogFloaty.pushErrorLog('重新进入背包后未在背包界面')
      return false
    }
    sleep(4000)
  }

  return true
}

// 在背包中查找匹配正则的TextView卡片，找同列可点击且可见的"使用"按钮（X中心点在屏幕内、底边在屏幕95%高度以内）并点击（检测"没有更多了"停止滑动）
function findAndUseCard (pattern) {
  sleep(2000)

  while (true) {
    let allNodes = widgetInspector.detectAllNodesVisible().nodes

    // 匹配所有符合条件的TextView卡片（要求中心点在屏幕内，确保可见）
    let cardNodes = allNodes.filter(function (n) {
      return n.text && n.className === 'android.widget.TextView' && pattern.test(n.text) && n.bounds &&
        n.bounds.centerX() >= 0 && n.bounds.centerX() <= config.device_width &&
        n.bounds.centerY() >= 0 && n.bounds.centerY() <= config.device_height
    })

    // 遍历所有匹配的卡片，找同列可点击且可见的"使用"按钮（X中心点在屏幕内、底边在屏幕95%高度以内；X坐标差值<50，卡片在按钮上方且y差值<200）
    for (let ci = 0; ci < cardNodes.length; ci++) {
      let cardNode = cardNodes[ci]
      let useNode = allNodes.find(function (n) {
        return n.text === '使用' && n.clickable && n.bounds &&
          n.bounds.centerX() >= 0 && n.bounds.centerX() <= config.device_width &&
          n.bounds.bottom >= 0 && n.bounds.bottom < config.device_height * 0.95 &&
          Math.abs(n.bounds.centerX() - cardNode.bounds.centerX()) < 50 &&
          cardNode.bounds.centerY() < n.bounds.centerY() &&
          Math.abs(n.bounds.centerY() - cardNode.bounds.centerY()) < 200
      })

      if (useNode) {
        automator.click(useNode.bounds.centerX(), useNode.bounds.centerY())
        sleep(3000)
        return true
      }
    }

    // 检查是否已到底部
    let hasEnd = allNodes.some(function (n) { return /没有更多了/.test(n.text) })
    if (hasEnd) {
      break
    }

    // 滑动起始点85%~95%高度随机，滑动距离5%~8%随机，持续时间100~400ms随机
    let dist = (0.05 + Math.random() * 0.03) * config.device_height
    let startY = config.device_height * (0.85 + Math.random() * 0.10)
    automator.gestureDown(Math.round(startY), Math.round(startY - dist), 100 + Math.round(Math.random() * 300))
    sleep(2000)
  }

  sleep(4000)
  LogFloaty.pushErrorLog('未找到卡片，可能已使用完或不存在')
  return false
}

// 点击"立即使用"弹窗
function clickUseNow () {
  sleep(2000)

  if (!findAndClickByTextVisible(/立即使用/)) {
    LogFloaty.pushErrorLog('未找到"立即使用"按钮')
    return false
  }

  sleep(4000)
  return true
}

// 判断当天是否已使用指定道具（通过森林动态时间线判断）：已使用返回true（退出主函数），未使用返回false
// usedPattern: 匹配道具使用记录的正则对象，如能量雨/使用了.*能量雨机会/
// 逻辑：进入森林动态后，只根据"动态"判断是否在森林动态界面；进入后若未找到"今天"则说明当天未使用，直接返回false；找到"今天"后下滑搜索，找到"昨天"则判断匹配项是否在昨天上方（在则已使用）；没找到"昨天"时当前页有匹配项即视为已使用；找到"昨天"即停止搜索；下滑超过60次未找到则保守处理视为未使用
function hasUsedItemToday (usedPattern) {
  taskLog('=== 检查当天是否已使用道具: ' + usedPattern + ' ===')

  // 进入蚂蚁森林并确认在首页
  if (!enterAntForest()) {
    LogFloaty.pushErrorLog('检查已使用：无法进入蚂蚁森林')
    return false
  }
  if (!isOnAntForestPage()) {
    LogFloaty.pushErrorLog('检查已使用：不在蚂蚁森林界面')
    return false
  }
  sleep(4000)

  // 最多下滑3次，寻找"森林动态"和"去看全部"（完全匹配）；起始点85%~95%高度随机，滑动距离10%~15%随机，持续时间100~400ms随机
  let foundEntry = false
  let h = config.device_height
  for (let i = 0; i < 3; i++) {
    // 滑动起始点85%~95%高度随机，滑动距离10%~15%随机，持续时间100~400ms随机
    let dist = (0.10 + Math.random() * 0.05) * h
    let startY = h * (0.85 + Math.random() * 0.10)
    automator.gestureDown(Math.round(startY), Math.round(startY - dist), 100 + Math.round(Math.random() * 300))
    sleep(2000)

    let hasForest = widgetUtils.widgetWaiting('^森林动态$', '森林动态', 10000)
    let hasSeeAll = widgetUtils.widgetWaiting('^去看全部$', '去看全部', 10000)
    if (hasForest && hasSeeAll) {
      foundEntry = true
      break
    }
  }

  if (!foundEntry) {
    taskLog('未找到"森林动态/去看全部"入口，视为未使用，继续执行')
    return false
  }

  // 点击"去看全部"
  if (!findAndClickByTextVisible(/^去看全部$/)) {
    taskLog('未找到可点击的"去看全部"，视为未使用')
    return false
  }
  sleep(4000)

  // 判断是否在森林动态界面：只根据"动态"判断（完全匹配）；进入后若未找到"今天"则说明当天未使用，直接返回
  let dongtaiResult = widgetUtils.widgetWaiting('^动态$', '动态', 10000)
  if (!dongtaiResult) {
    taskLog('未检测到"动态"，不在森林动态界面')
    return false
  }
  taskLog('检测到"动态"，确认在森林动态界面')

  // 进入森林动态后，若未找到"今天"则说明当天未使用，直接返回（false）
  let todayResult = widgetUtils.widgetWaiting('^今天$', '今天', 10000)
  if (!todayResult) {
    taskLog('未检测到"今天"，当天未使用该道具')
    return false
  }
  taskLog('检测到"今天"，继续执行使用判断')

  // 循环下滑搜索：查找匹配项与"昨天"（找到"昨天"即停止，类似findAndUseCard的hasEnd退出）
  // 找到"昨天"则判断匹配项y是否在其上方；没找到"昨天"时，当前页有匹配项即视为已使用
  // 每次循环i++，i大于60则保守处理（视为未使用）
  let i = 0
  while (true) {
    i++
    if (i > 60) {
      taskLog('下滑搜索超过60次未找到"昨天"，保守处理视为未使用')
      return false
    }
    let nodes = widgetInspector.detectAllNodesVisible().nodes

    // 收集当前页所有匹配usedPattern的节点（可能有多个）
    let usedNodes = nodes.filter(function (n) { return n.text && usedPattern.test(n.text) && n.bounds })

    // 找"昨天"节点
    let yesterdayNode = null
    for (let n of nodes) {
      if (n.text === '昨天' && n.bounds) {
        yesterdayNode = n
        break
      }
    }

    if (yesterdayNode) {
      // 找到"昨天"：判断任一匹配项y是否在昨天上方（不需要判断今天），满足即已使用；然后停止搜索
      let yesterdayY = yesterdayNode.bounds.centerY()
      for (let un of usedNodes) {
        if (un.bounds.centerY() < yesterdayY) {
          taskLog('检测到"' + usedPattern + '"位于昨天上方，当天已使用该道具')
          return true
        }
      }
      taskLog('找到"昨天"但未在昨天上方检测到"' + usedPattern + '"，视为未使用')
      return false
    }

    if (usedNodes.length > 0) {
      // 没找到"昨天"但当前页有匹配项，视为已使用
      taskLog('未找到"昨天"但检测到"' + usedPattern + '"，当天已使用该道具')
      return true
    }

    // 都没找到，下滑继续搜索（起始点85%~95%高度随机，滑动距离20%~25%随机，持续时间100~400ms随机）
    let dist = (0.20 + Math.random() * 0.05) * h
    let startY = h * (0.85 + Math.random() * 0.10)
    automator.gestureDown(Math.round(startY), Math.round(startY - dist), 100 + Math.round(Math.random() * 300))
    sleep(2000)
  }
}

// 通过上滑查找并点击"活力值积分商店"进入商店，点击后判断是否在商店
// 上滑起始点65%~70%高度随机，滑动距离20%~30%随机（结束点不超过95%），持续时间100~400ms随机；检测到商店后再执行3次上滑确保完整显示
function enterVitalityShopByScrollUp () {
  taskLog('=== 上滑查找并进入活力值积分商店 ===')
  let h = config.device_height

  // 循环上滑，每次上滑后检测可见节点中是否出现"活力值积分商店"（起始点65%~70%高度随机，向下滑让上方内容显示，幅度20%~30%随机且结束点不超过95%，持续时间100~400ms随机）
  // 注意：用可见节点判断而非widgetWaiting（widgetWaiting不检查可见性，会命中已渲染但不可见的节点导致误判）
  let found = false
  for (let i = 0; i < 10; i++) {
    let dist = (0.20 + Math.random() * 0.10) * h
    let startY = h * (0.65 + Math.random() * 0.05)
    let endY = Math.min(startY + dist, h * 0.95)
    automator.gestureUp(Math.round(startY), Math.round(endY), 100 + Math.round(Math.random() * 300))
    sleep(2000)
    let visibleNodes = widgetInspector.detectAllNodesVisible().nodes
    let hasShopEntry = visibleNodes.some(function (n) { return n.text && /活力值积分商店/.test(n.text) && n.bounds })
    if (hasShopEntry) {
      found = true
      // 检测到后再执行3次上滑，确保商店入口完整显示（每次重新生成随机起始点/距离/结束点）
      for (let j = 0; j < 3; j++) {
        let d = (0.20 + Math.random() * 0.10) * h
        let sy = h * (0.65 + Math.random() * 0.05)
        let ey = Math.min(sy + d, h * 0.95)
        automator.gestureUp(Math.round(sy), Math.round(ey), 100 + Math.round(Math.random() * 300))
        sleep(2000)
      }
      break
    }
  }

  if (!found) {
    taskLog('上滑多次未找到"活力值积分商店"')
    return false
  }

  // 点击"活力值积分商店"
  if (!findAndClickByTextVisible(/活力值积分商店/)) {
    taskLog('找到但点击"活力值积分商店"失败')
    return false
  }
  sleep(4000)

  // 判断是否在商店
  return isOnVitalityShopPage()
}

// 能量雨次卡流程
function doEnergyRainExchange () {
  taskLog('========== 能量雨次卡 开始 ==========')

  // 判断当天是否已使用能量雨机会，已使用则退出当前主函数
  if (hasUsedItemToday(/使用了.*能量雨机会/)) {
    taskLog('能量雨：当天已使用，跳过兑换')
    return true
  }

  taskLog('=== 进入蚂蚁森林并进入背包 ===')
  if (!enterAntForest()) {
    LogFloaty.pushErrorLog('能量雨：无法进入蚂蚁森林')
    return false
  }
  // 判断是否在蚂蚁森林界面
  if (!isOnAntForestPage()) {
    return false
  }
  sleep(4000)
  if (!enterBackpack()) {
    LogFloaty.pushErrorLog('能量雨：无法进入背包页面')
    return false
  }
  // 判断是否已进入背包界面
  if (!isOnBackpackPage()) {
    LogFloaty.pushErrorLog('能量雨：未在背包界面')
    return false
  }
  sleep(4000)

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
  if (!enterVitalityShopByScrollUp()) {
    taskLog('上滑进入商店失败，改用兜底方案')
    if (!clickExchangeWithVitality()) {
      LogFloaty.pushErrorLog('能量雨：无法进入活力值积分商店页面')
      return false
    }
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

// 切换为个人版（组队版下部分控件不存在，如森林动态）
// 控件文案 = 当前所在版本：存在"切换为个人版"即为个人版，存在"切换为组队版"即为组队版
// 点击后切到另一个版本；返回 true 表示原本是组队版（任务结束需切回）
function switchToPersonalVersion () {
  if (!enterAntForest()) { taskLog('版本检查：无法进入蚂蚁森林'); return false }
  if (!isOnAntForestPage()) { taskLog('版本检查：不在蚂蚁森林界面'); return false }
  if (existsVisibleText(/^切换为个人版$/)) { taskLog('版本检查：当前为个人版，无需切换'); return false }
  if (!existsVisibleText(/^切换为组队版$/)) { taskLog('版本检查：未检测到版本切换控件'); return false }
  taskLog('版本检查：当前为组队版，切换为个人版')
  sleep(5000)   // 切换前等待 5s
  if (!findAndClickByTextVisible(/^切换为组队版$/)) { taskLog('版本检查：点击"切换为组队版"失败'); return true }
  sleep(4000)
  findAndClickByTextVisible(/^确定返回$/)   // 可能无弹窗，失败即忽略
  sleep(4000)
  return true
}

// 切换为组队版（原版本为组队版时，在 main 末尾调用）
function switchToGroupVersion () {
  if (!enterAntForest()) { taskLog('版本还原：无法进入蚂蚁森林'); return false }
  if (!isOnAntForestPage()) { taskLog('版本还原：不在蚂蚁森林界面'); return false }
  taskLog('版本还原：切回组队版')
  sleep(2000)   // 切换前等待 2s

  let maxAttempts = 3
  for (let i = 0; i < maxAttempts; i++) {
    if (!findAndClickByTextVisible(/^切换为个人版$/)) {
      taskLog('版本还原：点击"切换为个人版"失败')
      return false
    }
    sleep(2000)                              // 点击切换后等待 2s
    findAndClickByTextVisible(/^确定返回$/)   // 弹窗可能不存在，失败即忽略
    sleep(2000)                              // 等切换生效 2s

    // 正向判断：出现"切换为组队版"才表示已成功切到组队版
    if (existsVisibleText(/^切换为组队版$/)) {
      taskLog('版本还原：已成功切换为组队版')
      return true
    }
    taskLog('版本还原：未检测到"切换为组队版"，继续循环（第' + (i + 1) + '次）')
  }

  taskLog('版本还原：重试 ' + maxAttempts + ' 次后仍未切换成功')
  return false
}

// 主流程
function main () {
  taskLog('========== 能量雨兑换 开始 ==========')

  // 组队版下部分控件不存在：进入后先切为个人版，记录原版本
  let wasGroupMode = switchToPersonalVersion()

  try {
    if (ENABLE_ENERGY_RAIN_EXCHANGE) {
      doEnergyRainExchange()
    }
  } finally {
    // 原为组队版则切回组队版
    if (wasGroupMode) {
      switchToGroupVersion()
    }
  }

  taskLog('========== 能量雨兑换 完成 ==========')
  return true
}

// 退出脚本：返回桌面并清理运行状态
function exitScript () {
  commonFunction.minimize()
  sleep(1000)
  killApps()
  sleep(1000)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

// ============================================================
// 执行入口
// ============================================================

if (executeByTimeTask) {
  // 自动模式
  taskLog('自动模式：开始能量雨兑换')
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
