/*
 * 自动执行乐园任务
 * 1. 打开蚂蚁森林 → OCR进入乐园
 * 2. 判断当前页面类型（限时福利/乐园/未知）
 * 3. 不在限时福利页面则OCR进入限时福利
 * 4. 限时福利页面：循环领取所有能量 → 循环找玩一玩任务
 * 5. 玩一玩任务完成后退出页面（检测包名切入支付宝 → back循环），失败则重新进入限时福利继续
 */
let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let args = config.parseExecArgv()
let sRequire = require('../lib/SingletonRequirer.js')(runtime, global)
let automator = sRequire('Automator')
let { debugInfo, warnInfo, errorInfo, infoLog, logInfo, debugForDev } = sRequire('LogUtils')
let commonFunction = sRequire('CommonFunction')
let widgetUtils = sRequire('WidgetUtils')
let FloatyInstance = sRequire('FloatyUtil')
let LogFloaty = sRequire('LogFloaty')
let runningQueueDispatcher = sRequire('RunningQueueDispatcher')
let localOcrUtil = require('../lib/LocalOcrUtil.js')
let FileUtils = require('../lib/prototype/FileUtils.js')
let killProcessUtil = require('../lib/KillProcessUtil.js')
let widgetInspector = require('../lib/WidgetInspector.js')(runtime, global)
let SwitchToApp = require('../lib/SwitchToApp.js')(runtime, global)

function killApps () {
  try {
    let killSuccess = killProcessUtil.kill(config.package_name || 'com.eg.android.AlipayGphone')
    taskLog('支付宝 → ' + (killSuccess ? '✓ 已杀掉' : '✗ 失败'))
  } catch (e) {
    taskLog('支付宝 → ✗ 失败: ' + e)
  }
}

runningQueueDispatcher.addRunningTask()

// 调试日志（仅悬浮窗显示，不写入文件）
function taskLog (msg) {
  LogFloaty.pushLog(msg)
}

if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exit()
}

// 音量由父脚本控制

// ============ 工具函数 ============

function openAntForest () {
  taskLog('正在打开蚂蚁森林')
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
  // 等待蚂蚁森林首页加载
  let waitCount = 0
  while (!widgetUtils.homePageWaiting() && waitCount++ < 10) {
    sleep(1000)
  }
  taskLog('蚂蚁森林已打开')
}

function goBack () {
  back()
  sleep(800)
}

/**
 * 通用OCR识别并点击指定关键字（带重试）
 */
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

/**
 * 遍历可见控件，匹配文本并点击
 * @param {RegExp} pattern - 匹配文本的正则（如 /^领取$/）
 * @returns {boolean} 是否找到并点击成功
 */
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

/**
 * 查找任务并执行：两遍遍历，先记录描述文字的y值，再匹配按钮文字做同行判断
 * @param {string} descText - 任务描述文字（匹配开头，如"玩一玩"）
 * @param {string} btnText - 按钮文字（完全匹配，如"去完成"）
 * @param {function} taskFn - 执行任务的函数
 * @returns {boolean} 是否找到并执行了任务
 */
function findAndExecuteTask (descText, btnText, taskFn) {
  let allNodes = widgetInspector.detectAllNodesVisible().nodes
  if (!allNodes || allNodes.length === 0) return false

  // 第一遍：记录描述文字的y值
  let descY = -1
  for (let i = 0; i < allNodes.length; i++) {
    let text = allNodes[i].text
    if (text.indexOf(descText) === 0) {
      descY = allNodes[i].bounds.centerY()
      break
    }
  }
  if (descY < 0) {
    taskLog('未找到任务: "' + descText + '"')
    return false
  }

  // 第二遍：匹配按钮文字，同行判断
  for (let i = 0; i < allNodes.length; i++) {
    let node = allNodes[i]
    if (node.text === btnText) {
      let y = node.bounds.centerY()
      if (Math.abs(y - descY) < 100) {
        taskLog('找到任务: "' + descText + '"，对应按钮: ' + btnText)
        automator.click(node.bounds.centerX(), node.bounds.centerY())
        sleep(2000)
        taskFn()
        return true
      }
    }
  }
  taskLog('找到任务: "' + descText + '"，未找到对应按钮: ' + btnText + '"，任务可能已完成')
  return false
}

/**
 * 判断当前页面类型
 * 限时福利页面：包含"每日来森林乐园签到"（开头匹配）
 * 乐园页面：包含"每日领取上限"或"开宝箱...绿色能量"（开头匹配）
 * @returns {string} 'limited_benefit' | 'park' | 'unknown'
 */
function detectPageType () {
  let result = widgetUtils.widgetWaiting('每日来森林乐园签到|每日领取上限|开宝箱.*绿色能量', '限时福利/乐园页面', 5000)
  if (!result) return 'unknown'

  let allNodes = widgetInspector.detectAllNodesVisible().nodes
  let hasSignIn = false
  let hasEnergyTask = false
  for (let node of allNodes) {
    if (node.text.indexOf('每日来森林乐园签到') === 0) hasSignIn = true
    if (node.text.indexOf('每日领取上限') === 0 || /^开宝箱.*绿色能量/.test(node.text)) hasEnergyTask = true
  }
  if (hasSignIn) return 'limited_benefit'
  if (hasEnergyTask) return 'park'
  return 'unknown'
}

/**
 * 判断是否在限时福利页面（检测"每日来森林乐园签到"）
 * @returns {boolean}
 */
function isOnLimitedBenefitPage () {
  let result = widgetUtils.widgetWaiting('每日来森林乐园签到', '限时福利页面', 3000)
  if (!result) {
    taskLog('未检测到"每日来森林乐园签到"，不在限时福利页面')
    return false
  }
  taskLog('检测到"每日来森林乐园签到"，确认在限时福利页面')
  return true
}

/**
 * 重新进入限时福利页面
 * 打开蚂蚁森林 → OCR进入乐园 → 进入限时福利
 * 最多尝试3次
 * @returns {boolean} 是否成功进入限时福利页面
 */
function enterLimitedBenefitPage () {
  for (let attempt = 0; attempt < 3; attempt++) {
    taskLog('尝试进入限时福利页面，第' + (attempt + 1) + '次')
    openAntForest()
    taskLog('查找乐园入口')
    if (!clickByOcr('乐园', 5000)) {
      taskLog('OCR未找到乐园入口')
      continue
    }
    sleep(3000)

    // 判断当前页面：可能在限时福利页面或乐园页面
    let pageType = detectPageType()
    taskLog('进入乐园后页面类型: ' + pageType)
    if (pageType === 'limited_benefit') {
      taskLog('已在限时福利页面')
      return true
    }
    // 在乐园页面（或未知），需要进入限时福利
    taskLog('查找限时福利入口')
    if (!clickByOcr('限时福利', 5000)) {
      taskLog('OCR未找到限时福利入口')
      continue
    }
    sleep(2000)
    if (isOnLimitedBenefitPage()) {
      taskLog('成功进入限时福利页面')
      return true
    }
    taskLog('未进入限时福利页面，准备重试')
  }
  errorInfo('无法进入限时福利页面，已尝试3次')
  return false
}

/**
 * 遍历点击所有"领取"按钮（重复直到找不到）
 */
function claimAllEnergy () {
  while (findAndClickByTextVisible(/^领取$/)) {
    sleep(1500)
  }
}

/**
 * 等待玩一玩任务完成
 * 1. 先等待5分钟让任务自动完成
 * 2. 每5秒检查一次"已完成"（最多6次）
 * 3. 退出玩一玩页面：先检测包名切入支付宝，再back循环回到限时福利，失败则重新进入
 * @returns {boolean} 是否成功回到限时福利页面
 */
function waitForGameComplete () {
  taskLog('进入玩一玩页面，先等待5分钟，然后每5秒检查一次（最多6次）')
  sleep(2000)

  // 先等待5分钟（300秒）
  taskLog('等待300秒让任务自动完成...')
  sleep(300000)

  let maxChecks = 6
  for (let check = 1; check <= maxChecks; check++) {
    sleep(5000)
    taskLog('第' + check + '/' + maxChecks + '次检查玩一玩状态...')
    let completed = widgetUtils.widgetGetOne('已完成', 1000)
    if (completed) {
      taskLog('检测到已完成')
      break
    }
  }

  // 退出玩一玩页面，与每日任务waitForTaskComplete一致
  taskLog('任务完成，退出页面')
  sleep(2000)

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
      sleep(500)
      openAntForest()
      return enterLimitedBenefitPage()
    }
    sleep(1000)
  }

  // 2. 返回逻辑：先检测后back，循环直到回到限时福利页面
  let maxBacks = 3
  for (let i = 0; i < maxBacks; i++) {
    // 先检测是否已在限时福利页面
    if (isOnLimitedBenefitPage()) {
      taskLog('已回到限时福利页面')
      return true
    }
    // 不在则back
    taskLog('第' + (i + 1) + '次back')
    goBack()
    sleep(3000)
  }

  taskLog('多次back后仍未回到限时福利页面，重新进入')
  commonFunction.minimize()
  sleep(500)
  openAntForest()
  return enterLimitedBenefitPage()
}

// ============ 主流程 ============

function main () {
  // 音量上键退出脚本（在独立线程中轮询检测）
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

  // 1. 打开蚂蚁森林
  openAntForest()

  // 2. 进入乐园
  taskLog('查找乐园入口')
  if (!clickByOcr('乐园', 5000)) {
    errorInfo('无法定位乐园入口，结束乐园任务')
    commonFunction.minimize()
    sleep(500)
    killApps()
    sleep(1000)
    runningQueueDispatcher.removeRunningTask()
    exit()
  }

  // 3. 判断当前页面类型
  sleep(3000)
  let pageType = detectPageType()
  taskLog('当前页面类型: ' + pageType)

  // 如果不是限时福利页面，尝试进入限时福利
  if (pageType !== 'limited_benefit') {
    taskLog('当前不在限时福利页面，尝试进入限时福利')
    // 先点击进入限时福利
    if (!clickByOcr('限时福利', 5000)) {
      errorInfo('未找到限时福利入口，结束乐园任务')
      commonFunction.minimize()
      sleep(500)
      killApps()
      sleep(1000)
      runningQueueDispatcher.removeRunningTask()
      exit()
    }
    // 再确认限时福利页面已加载
    if (!isOnLimitedBenefitPage()) {
      errorInfo('进入限时福利页面失败，结束乐园任务')
      commonFunction.minimize()
      sleep(500)
      killApps()
      sleep(1000)
      runningQueueDispatcher.removeRunningTask()
      exit()
    }
  }

  // 4. 限时福利页面：先领所有能量，然后循环做玩一玩任务
  taskLog('开始执行限时福利任务')

  // 先领能量
  claimAllEnergy()

  // 循环找玩一玩任务
  let taskFailed = false
  while (findAndExecuteTask('玩一玩', '去完成', function () {
    let result = waitForGameComplete()
    if (!result) taskFailed = true
    return result
  })) {
    // 每次完成任务后先领能量
    claimAllEnergy()
    if (taskFailed) break
  }

  // 5. 任务完成
  if (taskFailed) {
    taskLog('任务异常结束，退出脚本')
  } else {
    taskLog('所有任务已完成，返回原页面')
  }
  commonFunction.minimize()
  sleep(500)
  killApps()
  sleep(1000)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

main()
