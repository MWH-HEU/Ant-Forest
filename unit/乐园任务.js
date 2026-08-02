/*
 * 自动执行乐园任务
 * 1. enterLimitedBenefitPage进入限时福利页面（打开蚂蚁森林 → 进入乐园 → 进入限时福利）
 * 2. 限时福利页面：循环领取所有能量 → 循环找玩一玩任务
 * 3. 玩一玩任务完成后退出页面（直接切入支付宝 → 切入失败或不在限时福利页面则重新打开限时福利继续）
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

function exitScript () {
  commonFunction.minimize()
  sleep(500)
  killApps()
  sleep(500)
  runningQueueDispatcher.removeRunningTask()
  exit()
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

  // 等待进入首页
  let waitCount = 0
  while (!widgetUtils.homePageWaiting() && waitCount++ < 10) {
    sleep(1000)
  }

  // while 退出后，waitCount >= 10 说明超时未进入首页
  if (waitCount >= 10) {
    errorInfo('进入蚂蚁森林失败')
    return false
  }
  sleep(2000)
  return true
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
 * 判断是否在蚂蚁森林首页（需同时找到"蚂蚁森林"和"森林广场"）
 * @returns {boolean}
 */
function isOnAntForestPage () {
  let result = widgetUtils.widgetWaiting('蚂蚁森林', '蚂蚁森林首页', 5000)
  if (!result) {
    taskLog('未检测到"蚂蚁森林"，不在蚂蚁森林界面')
    return false
  }
  let squareResult = widgetUtils.widgetWaiting('森林广场', '蚂蚁森林首页', 5000)
  if (!squareResult) {
    taskLog('未检测到"森林广场"，不在蚂蚁森林界面')
    return false
  }
  taskLog('检测到"蚂蚁森林"和"森林广场"，确认在蚂蚁森林界面')
  return true
}

/**
 * 判断是否在乐园页面（检测"每日领取上限"或"开宝箱...绿色能量"）
 * 限时福利是浮层，打开时乐园控件仍存在，需先排除限时福利浮层
 * @returns {boolean}
 */
function isOnParkPage () {
  // 限时福利浮层打开时，乐园控件仍存在，先排除
  if (isOnLimitedBenefitPage()) return false
  // textMatches为全文匹配，需用.*通配匹配包含关键字的完整文本
  let result = widgetUtils.widgetWaiting('.*每日领取上限.*|.*开宝箱.*绿色能量.*', '乐园页面', 3000)
  if (!result) {
    taskLog('未检测到乐园页面特征控件，不在乐园页面')
    return false
  }
  taskLog('检测到乐园页面特征控件，确认在乐园页面')
  return true
}

/**
 * 判断是否在限时福利页面（完全匹配"每日签到"或"开10个乐园宝箱"）
 * @returns {boolean}
 */
function isOnLimitedBenefitPage () {
  // 限时福利是浮层，widgetWaiting的findOne可能找不到浮层控件，改用detectAllNodesVisible
  // 先等待页面加载完成
  sleep(3000)
  let allNodes = widgetInspector.detectAllNodesVisible().nodes
  for (let node of allNodes) {
    // 完全匹配"每日签到"或"开10个乐园宝箱"
    if (node.text === '每日签到' || node.text === '开10个乐园宝箱') {
      taskLog('检测到"每日签到/开10个乐园宝箱"，确认在限时福利页面')
      return true
    }
  }
  taskLog('未检测到"每日签到/开10个乐园宝箱"，不在限时福利页面')
  return false
}

/**
 * 确保在限时福利页面
 * 1. 已在限时福利页面 → 返回true
 * 2. 不在乐园页面 → 返回false
 * 3. 在乐园页面 → OCR进入限时福利 → 再检测一次
 * @returns {boolean} 是否成功确保在限时福利页面
 */
function ensureOnLimitedBenefitPage () {
  // 1. 已在限时福利页面
  if (isOnLimitedBenefitPage()) return true
  // 2. 不在乐园页面 → 失败
  if (!isOnParkPage()) return false
  // 3. 在乐园页面，OCR进入限时福利
  taskLog('在乐园页面，进入限时福利')
  if (!clickByOcr('限时福利', 5000)) return false
  sleep(2000)
  return isOnLimitedBenefitPage()
}

/**
 * 重新进入限时福利页面
 * 打开蚂蚁森林 → OCR进入乐园 → 进入限时福利
 * 单次执行，失败返回false
 * @returns {boolean} 是否成功进入限时福利页面
 */
function enterLimitedBenefitPage () {
  taskLog('尝试进入限时福利页面')
  if (!openAntForest()) {
    taskLog('进入蚂蚁森林失败')
    return false
  }
  // 调用乐园界面之前，判断是否在蚂蚁森林首页
  if (!isOnAntForestPage()) {
    taskLog('不在蚂蚁森林首页')
    return false
  }
  sleep(2000)

  taskLog('查找乐园入口')
  if (!clickByOcr('乐园', 5000)) {
    taskLog('OCR未找到乐园入口')
    return false
  }
  sleep(2000)

  // 确保在限时福利页面（已在则直接成功，在乐园则OCR进入，否则失败）
  if (ensureOnLimitedBenefitPage()) {
    taskLog('成功进入限时福利页面')
    return true
  }
  taskLog('未进入限时福利页面')
  return false
}

/**
 * 遍历点击所有"领取"按钮（重复直到找不到）
 */
function claimAllEnergy () {
  while (findAndClickByTextVisible(/^领取$/)) {
    sleep(2000)
  }
}

/**
 * 等待玩一玩任务完成
 * 1. 先等待5分钟让任务自动完成
 * 2. 每5秒检查一次"已完成"（最多6次）
 * 3. 退出玩一玩页面：直接切入支付宝 → 切入失败或不在限时福利页面则重新打开限时福利页面
 * @returns {boolean} 是否成功回到限时福利页面
 */
function waitForGameComplete () {
  taskLog('进入玩一玩页面，先等待5分钟，然后每5秒检查一次（最多6次）')

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
  sleep(500)

  let pkg = config.package_name || 'com.eg.android.AlipayGphone'

  // 1. 直接切入支付宝（不做包名检查）
  taskLog('切入支付宝')
  let switched = SwitchToApp.switchToApp({
    pkg: pkg,
    cardText: '支付宝',
    onLog: taskLog
  })
  sleep(1000)

  // 2. 切入失败或切入后不在限时福利页面，重新打开限时福利页面
  if (!switched || !isOnLimitedBenefitPage()) {
    taskLog('切入失败或不在限时福利页面，重新打开限时福利页面')
    return enterLimitedBenefitPage()
  }
  taskLog('已回到限时福利页面')
  return true
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
        exitScript()
      }
    })
  })

  // 1. 进入限时福利页面（打开蚂蚁森林 → 进入乐园 → 进入限时福利，单次执行，失败则退出）
  if (!enterLimitedBenefitPage()) {
    errorInfo('进入限时福利页面失败，结束乐园任务')
    exitScript()
  }

  // 2. 限时福利页面：先领所有能量，然后循环做玩一玩任务
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

  // 3. 任务完成
  if (taskFailed) {
    taskLog('任务异常结束，退出脚本')
  } else {
    taskLog('所有任务已完成，返回原页面')
  }
  exitScript()
}

main()
