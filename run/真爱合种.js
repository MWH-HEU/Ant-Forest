/*
 * @Description: 真爱合种子脚本（纯核心任务代码）
 * 架构参考森林集市/神奇鱼塘：父脚本负责解锁、静音、倒计时弹窗、等待子脚本、锁屏；
 * 本脚本只负责真爱合种核心任务。
 *
 * 流程：
 *   1. 打开蚂蚁森林并确认在首页，等待3s后查找并点击"真爱合种"入口进入真爱合种页面；
 *      未找到入口则报错并退出。
 *   2. 进入后等待4s，尝试点击"我知道啦"领取道具；若存在说明今日任务已完成，
 *      等待3s后直接 exitScript 退出。
 *   3. 判断是否在真爱合种页面（"真爱合种""累计一起攒能量""证书""去种树"均存在）。
 *   4. 按坐标点击进入攒能量明细：x 取"去种树"控件中心x，y 取"累计一起攒能量"控件中心y；
 *      坐标点击失败时用OCR识别"明细"并点击。
 *   5. 判断是否在攒能量明细页面（"真爱合种攒能量明细"和"攒能量明细"均存在）。
 *   6. 遍历所有"时间：yyyy.MM.dd"文本，对每个今天的日期条目依次判断：
 *      若存在完全匹配的"我"，且"我"在日期上方、y 相差不超过100，则今天已浇水，退出；
 *      否则返回真爱合种页面执行浇水。
 *   7. 浇水：获取"真爱.*装扮"控件，点击 (屏幕宽度0.5, 控件centerY + 2*控件高度)；
 *      未获取到时点击 (屏幕宽度0.5, 屏幕高度0.5)。确认页需存在 Button 类型
 *      "攒能量"和"关闭"，否则报错退出；点击"攒能量"后等待3s完成退出。
 */
let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let args = config.parseExecArgv()
let sRequire = require('../lib/SingletonRequirer.js')(runtime, global)
// 将 singletonRequire 挂到全局，供 YoloTrainHelper 等模块内部使用
singletonRequire = sRequire
let automator = sRequire('Automator')
let { debugInfo, warnInfo, errorInfo, infoLog, logInfo, debugForDev } = sRequire('LogUtils')
let commonFunction = sRequire('CommonFunction')
let widgetUtils = sRequire('WidgetUtils')
let LogFloaty = sRequire('LogFloaty')
let runningQueueDispatcher = sRequire('RunningQueueDispatcher')
let killProcessUtil = require('../lib/KillProcessUtil.js')
let widgetInspector = require('../lib/WidgetInspector.js')(runtime, global)
let localOcrUtil = require('../lib/LocalOcrUtil.js')

function killApps () {
  try {
    killProcessUtil.killMultiple([
      { pkg: config.package_name || 'com.eg.android.AlipayGphone', name: '支付宝' }
    ], function (name, success) {
      taskLog(name + ' → ' + (success ? '✓ 已杀掉' : '✗ 失败'))
    })
  } catch (e) {
    taskLog('kill进程失败: ' + e)
  }
}

runningQueueDispatcher.addRunningTask()

if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exit()
}

// 注册自动移除运行中任务
commonFunction.registerOnEngineRemoved(function () {
  config.resetBrightness && config.resetBrightness()
  runningQueueDispatcher.removeRunningTask(true, false, () => {
    config.isRunning = false
  })
}, 'main')

// ============ 工具函数 ============

function taskLog (msg) {
  LogFloaty.pushLog(msg)
}

function goBack () {
  back()
  sleep(3000)
}

/**
 * 退出脚本：返回桌面 → 杀进程 → 移除运行中任务 → exit
 */
function exitScript () {
  commonFunction.minimize()
  sleep(1000)
  killApps()
  sleep(1000)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

/**
 * 遍历可见控件（visibleToUser），正则匹配文本并点击
 * @param {RegExp} pattern - 匹配文本的正则
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
 * OCR查找并点击指定文字（在超时内循环截图识别，找到即点击）
 * @param {string} keyword - OCR识别文字
 * @param {number} timeout - 超时时间
 * @returns {boolean} 是否找到并点击成功
 */
function clickByOcr (keyword, timeout) {
  if (!localOcrUtil.enabled) {
    taskLog('本地OCR不可用，无法识别"' + keyword + '"')
    return false
  }
  let deadline = new Date().getTime() + (timeout || 5000)
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
        return true
      }
    }
    sleep(2000)
  }
  return false
}

// ============ 进入蚂蚁森林 ============

/**
 * 打开蚂蚁森林：intent直达 + 点"打开"对话框 + 等待首页
 * @returns {boolean} 是否成功打开蚂蚁森林
 */
function enterAntForest () {
  taskLog('进入蚂蚁森林')

  commonFunction.backHomeIfInVideoPackage()

  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=60000002',
    packageName: config.package_name
  })

  let confirm = widgetUtils.widgetGetOne(/^打开$/, 3000)
  if (confirm) {
    automator.clickCenter(confirm)
  }

  let entered = false
  let waitCount = 0
  while (waitCount++ < 10) {
    if (widgetUtils.homePageWaiting()) {
      entered = true
      break
    }
    sleep(2000)
  }

  if (!entered) {
    errorInfo('进入蚂蚁森林失败')
    return false
  }
  taskLog('进入蚂蚁森林成功')
  return true
}

/**
 * 判断是否在蚂蚁森林首页（需同时找到"蚂蚁森林"和"森林广场"）
 * @returns {boolean} 是否在蚂蚁森林首页
 */
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

// ============ 真爱合种页面 ============

/**
 * 判断是否在真爱合种页面
 * "真爱合种""累计一起攒能量""证书""去种树"均存在才视为在页面
 * @returns {boolean} 是否在真爱合种页面
 */
function isOnLoveCoPlantPage () {
  let checks = [
    { pattern: '.*真爱合种.*', name: '真爱合种' },
    { pattern: '.*累计一起攒能量.*', name: '累计一起攒能量' },
    { pattern: '.*证书.*', name: '证书' },
    { pattern: '.*去种树.*', name: '去种树' }
  ]
  for (let i = 0; i < checks.length; i++) {
    let check = checks[i]
    if (!widgetUtils.widgetWaiting(check.pattern, '真爱合种页面-' + check.name, 10000)) {
      taskLog('未检测到"' + check.name + '"，不在真爱合种页面')
      return false
    }
  }
  taskLog('检测到真爱合种页面文本，确认在真爱合种页面')
  return true
}

/**
 * 进入真爱合种页面：
 * 进入蚂蚁森林首页并确认 → 等待3s → 查找并点击"真爱合种"入口
 * （可见控件点击失败时直接点击入口控件）→ 等待4s → 处理"我知道啦"领取道具弹窗
 * 若出现"我知道啦"，说明今天任务已完成，等待3s后退出脚本
 * @returns {boolean} 是否成功进入真爱合种页面
 */
function enterLoveCoPlantPage () {
  taskLog('准备进入真爱合种')
  if (!enterAntForest()) {
    errorInfo('进入蚂蚁森林失败')
    return false
  }
  if (!isOnAntForestPage()) {
    errorInfo('不在蚂蚁森林首页')
    return false
  }

  // 首页稳定后再查找入口
  sleep(3000)
  let entry = widgetUtils.widgetGetOne('.*真爱合种.*', 10000)
  if (!entry) {
    errorInfo('未找到真爱合种入口')
    return false
  }
  if (!findAndClickByTextVisible(/真爱合种/)) {
    taskLog('未通过可见控件点击到真爱合种入口，尝试直接点击入口控件')
    automator.clickCenter(entry)
  }

  // 等待页面加载并处理领取道具弹窗
  sleep(4000)
  if (findAndClickByTextVisible(/我知道啦/)) {
    taskLog('检测到"我知道啦"领取道具弹窗，今日任务已完成')
    sleep(3000)
    exitScript()
  }

  if (!isOnLoveCoPlantPage()) {
    errorInfo('不在真爱合种页面')
    return false
  }
  return true
}

// ============ 攒能量明细页面 ============

/**
 * 判断是否在攒能量明细页面（"真爱合种攒能量明细"和"攒能量明细"均存在）
 * @returns {boolean} 是否在攒能量明细页面
 */
function isOnEnergyDetailPage () {
  if (!widgetUtils.widgetWaiting('真爱合种攒能量明细', '攒能量明细页面', 10000)) {
    taskLog('未检测到"真爱合种攒能量明细"，不在攒能量明细页面')
    return false
  }
  if (!widgetUtils.widgetWaiting('攒能量明细', '攒能量明细页面', 10000)) {
    taskLog('未检测到"攒能量明细"，不在攒能量明细页面')
    return false
  }
  taskLog('检测到"真爱合种攒能量明细"和"攒能量明细"，确认在攒能量明细页面')
  return true
}

/**
 * 进入攒能量明细页面：
 * 点击坐标 (x 取"去种树"控件中心x, y 取"累计一起攒能量"控件中心y)，等待3s后判断
 * 未进入时用OCR识别"明细"并点击，等待3s后再次判断
 * @returns {boolean} 是否成功进入攒能量明细页面
 */
function enterEnergyDetailPage () {
  taskLog('点击进入攒能量明细')
  let result = widgetInspector.detectAllNodesVisible()
  let treeNode = null
  let accumulateNode = null
  for (let i = 0; i < result.nodes.length; i++) {
    let node = result.nodes[i]
    if (!treeNode && /去种树/.test(node.text) && node.bounds) {
      treeNode = node
    }
    if (!accumulateNode && /累计一起攒能量/.test(node.text) && node.bounds) {
      accumulateNode = node
    }
  }
  if (!treeNode || !accumulateNode) {
    errorInfo('未找到"去种树"或"累计一起攒能量"控件，无法进入攒能量明细')
    return false
  }

  let x = treeNode.bounds.centerX()
  let y = accumulateNode.bounds.centerY()
  taskLog('点击坐标进入明细: (' + x + ', ' + y + ')')
  automator.click(x, y)
  sleep(3000)

  if (isOnEnergyDetailPage()) {
    return true
  }

  taskLog('坐标点击未进入攒能量明细，尝试OCR识别"明细"并点击')
  if (clickByOcr('明细', 5000)) {
    sleep(3000)
    if (isOnEnergyDetailPage()) {
      return true
    }
  }
  return false
}

// ============ 今日浇水判断 ============

function pad2 (num) {
  return num < 10 ? '0' + num : '' + num
}

/**
 * 获取今天的日期字符串，格式 yyyy.MM.dd（月、日补零）
 * @returns {string}
 */
function getTodayString () {
  let now = new Date()
  return now.getFullYear() + '.' + pad2(now.getMonth() + 1) + '.' + pad2(now.getDate())
}

/**
 * 判断今天是否已经浇过水
 * 遍历所有含"时间：yyyy.MM.dd"（今天）的文本，对每个今天的日期条目依次判断：
 * 存在完全匹配的"我"，且"我"在日期上方、y 相差不超过100，则今天已浇水
 * 两人都浇水时会存在两个今天的日期，因此需要遍历所有今天的日期
 * @returns {boolean} 今天是否已经浇过水
 */
function checkWateredToday () {
  let today = getTodayString()
  let dateRegex = new RegExp('时间[：:]\\s*' + today.replace(/\./g, '\\.'))
  taskLog('判断今日是否浇水，今天日期：' + today)

  let result = widgetInspector.detectAllNodesVisible()
  let dateNodes = []
  let meNodes = []
  for (let i = 0; i < result.nodes.length; i++) {
    let node = result.nodes[i]
    if (!node.bounds) {
      continue
    }
    if (node.text && dateRegex.test(node.text)) {
      dateNodes.push(node)
    }
    if (node.text === '我') {
      meNodes.push(node)
    }
  }

  if (dateNodes.length === 0) {
    taskLog('未找到今天日期的攒能量记录，今天未浇水')
    return false
  }

  taskLog('找到' + dateNodes.length + '个今天的日期条目，开始逐条判断')
  for (let i = 0; i < dateNodes.length; i++) {
    let dateNode = dateNodes[i]
    let dateY = dateNode.bounds.centerY()
    taskLog('检查日期条目[' + dateNode.text + '] y=' + dateY)
    for (let j = 0; j < meNodes.length; j++) {
      let meNode = meNodes[j]
      let meY = meNode.bounds.centerY()
      if (meY < dateY && dateY - meY <= 100) {
        taskLog('"我"在日期上方且y相差' + (dateY - meY) + '，今天已浇水')
        return true
      }
    }
  }
  taskLog('今天存在日期条目，但未找到日期上方100px内的"我"，今天未浇水')
  return false
}

// ============ 返回真爱合种页面 ============

/**
 * 返回真爱合种页面：goback 后判断是否在页面，不在则重新进入
 * @returns {boolean} 是否成功返回真爱合种页面
 */
function returnToLoveCoPlantPage () {
  taskLog('返回真爱合种页面')
  goBack()
  if (isOnLoveCoPlantPage()) {
    return true
  }
  taskLog('返回后不在真爱合种页面，重新进入')
  return enterLoveCoPlantPage()
}

/**
 * 查找指定文本的 android.widget.Button 控件（轮询，直到两个按钮都找到或超时）
 * @param {number} timeout - 超时时间
 * @returns {{energyButton: Object, closeButton: Object}} 找到的按钮，未找到的为 null
 */
function findConfirmButtons (timeout) {
  let start = new Date().getTime()
  let energyButton = null
  let closeButton = null
  while (new Date().getTime() - start < timeout) {
    let result = widgetInspector.detectAllNodesVisible()
    energyButton = null
    closeButton = null
    for (let i = 0; i < result.nodes.length; i++) {
      let node = result.nodes[i]
      if (node.className !== 'android.widget.Button' || !node.bounds) {
        continue
      }
      if (node.text === '攒能量') {
        energyButton = node
      } else if (node.text === '关闭') {
        closeButton = node
      }
    }
    if (energyButton && closeButton) {
      return { energyButton: energyButton, closeButton: closeButton }
    }
    sleep(1000)
  }
  return { energyButton: energyButton, closeButton: closeButton }
}

/**
 * 真爱合种浇水：
 * 1. 获取"真爱.*装扮"控件坐标，点击 (屏幕宽度0.5, centerY + 2*height)，
 *    未获取到时 y 取屏幕高度0.5；点击后等待3s。
 * 2. 轮询等待确认页面出现 Button 类型的"攒能量"和"关闭"（最长10s），
 *    不存在则报错返回 false。
 * 3. 点击 Button 类型的"攒能量"，等待3s。
 * @returns {boolean} 浇水是否成功
 */
function doWatering () {
  taskLog('开始真爱合种浇水')
  let result = widgetInspector.detectAllNodesVisible()
  let dressNode = null
  for (let i = 0; i < result.nodes.length; i++) {
    let node = result.nodes[i]
    if (node.text && /真爱.*装扮/.test(node.text) && node.bounds) {
      dressNode = node
      break
    }
  }

  let clickX = Math.round(config.device_width * 0.5)
  let clickY = Math.round(config.device_height * 0.5)
  if (dressNode) {
    let bd = dressNode.bounds
    clickY = Math.round(bd.centerY() + 2 * bd.height())
    taskLog('找到"' + dressNode.text + '" bounds=[' + bd.left + ',' + bd.top + ',' + bd.width() + ',' + bd.height() +
      '] center=(' + bd.centerX() + ',' + bd.centerY() + ')，点击: (' + clickX + ', ' + clickY + ')')
  } else {
    taskLog('未找到"真爱.*装扮"，按屏幕中心点击: (' + clickX + ', ' + clickY + ')')
  }
  automator.click(clickX, clickY)
  sleep(3000)

  let buttons = findConfirmButtons(10000)
  if (!buttons.energyButton || !buttons.closeButton) {
    errorInfo('未进入浇水确认页面，未找到Button类型的"攒能量"或"关闭"')
    return false
  }
  taskLog('确认页面正常，点击Button类型"攒能量"')
  automator.click(buttons.energyButton.bounds.centerX(), buttons.energyButton.bounds.centerY())
  sleep(3000)
  return true
}

// ============ 主流程 ============

taskLog('真爱合种任务开始')

if (!enterLoveCoPlantPage()) {
  errorInfo('进入真爱合种页面失败，退出脚本')
  exitScript()
}

if (!enterEnergyDetailPage()) {
  errorInfo('进入攒能量明细页面失败，退出脚本')
  exitScript()
}

if (checkWateredToday()) {
  taskLog('今天已经浇过水，跳过今天的浇水')
  sleep(3000)
  exitScript()
}

taskLog('今日尚未浇水，返回真爱合种页面准备浇水')
if (!returnToLoveCoPlantPage()) {
  errorInfo('返回真爱合种页面失败，退出脚本')
  exitScript()
}

if (!doWatering()) {
  errorInfo('真爱合种浇水失败，退出脚本')
  exitScript()
}

taskLog('真爱合种浇水完成')
exitScript()
