/*
 * 森林集市任务脚本（子脚本，纯核心任务代码）
 * 架构参考神奇鱼塘：父脚本负责解锁、音量控制、静音、倒计时弹窗、等待子脚本、锁屏；
 * 本脚本只负责森林集市核心任务。
 *
 * 流程：
 *   1. 打开森林集市（enterMarket，沿用旧脚本 intent 方式），判断是否在页面
 *      （isOnMarketPage：绿色商品、绿色快消、绿色食品、下单得能量），不在则 exitScript 退出；
 *      保留 closeFirstPurchaseRedPack 处理。
 *   2. 始终为真的 while 循环，调用 findAndExecuteTasks 判断任务：
 *      2.1 检测到"浏览商品\d+s得能量" → BrowserExecutor，checkAndClickIfTaskEnd 为真后等待2s继续循环
 *      2.2 检测到"点击"与"即可获得"同行 → ClickExecutor，判断任务完成同2.1
 *      2.3 同时检测到"任务已完成.*立即领取"与"可领取" → 点击可领取，等待5s继续循环
 *      2.4 其他情况视为任务完成，退出循环
 *   3. 打开蚂蚁森林收取能量（collectOwnEnergy，循环4次），isOnAntForestPage 判断是否在蚂蚁森林主页
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

function killApps () {
  try {
    killProcessUtil.killMultiple([
      { pkg: config.package_name || 'com.eg.android.AlipayGphone', name: '支付宝' }
    ], function(name, success) {
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
  sleep(2000)
}

/**
 * 退出脚本：返回桌面 → 杀进程 → 移除运行中任务 → exit
 * 参考复活能量 exitScript
 */
function exitScript () {
  commonFunction.minimize()
  sleep(500)
  killApps()
  sleep(500)
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

// ============ 打开森林集市（形如 enterAntForest 格式） ============

/**
 * 打开森林集市：intent直达 + 点"打开"对话框 + 等待首页 + 校验"绿色商品"
 * 失败直接返回 false，不做多次重试
 * @returns {boolean} 是否成功打开并进入森林集市页面
 */
function enterMarket () {
  taskLog('进入森林集市')

  commonFunction.backHomeIfInVideoPackage()

  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=2019072665961762&page=pages%2Fant%2Findex%3F%24%24_share_uid%3Dr9D1H0xiGjQBASQIhCEXn3n9%26%24%24_utm_medium%3D3&enbsv=0.2.2503111357.59&chInfo=ch_share__chsub_CopyLink&fxzjshareChinfo=ch_share__chsub_CopyLink&shareTimestamp=1741767573196&apshareid=619a04b2-24f0-4035-8170-761779f0c278&shareBizType=H5App_XCX',
    packageName: config.package_name
  })

  let confirm = widgetUtils.widgetGetOne(/^打开$/, 1000)
  if (confirm) {
    automator.clickCenter(confirm)
  }

  commonFunction.readyForAlipayWidgets()

  // 校验"绿色商品"，确认进入森林集市页面
  if (!widgetUtils.widgetWaiting('绿色商品', '森林集市页面', 5000)) {
    warnInfo('无法校验 绿色商品 控件，可能没有正确打开')
    return false
  }

  return true
}

/**
 * 关闭首购红包弹窗，如果识别到首购红包则重新进入森林集市
 */
function closeFirstPurchaseRedPack () {
  // 先确认弹窗是否存在（查找"首购红包"或"点击领取"文本）
  if (!widgetUtils.widgetGetOne('首购红包|点击领取', 2000)) {
    debugInfo(['未发现首购红包弹窗'])
    return
  }
  taskLog('发现首购红包弹窗，重新进入森林集市')
  // 重新进入森林集市
  commonFunction.minimize()
  sleep(500)
  enterMarket()
}

// ============ 页面判断 ============

/**
 * 判断是否在森林集市页面（需同时找到"绿色商品、绿色快消、绿色食品、下单得能量"）
 * 封装形如限时道具兑换 isOnBackpackPage
 * @returns {boolean} 是否在森林集市页面
 */
function isOnMarketPage () {
  let texts = ['绿色商品', '绿色快消', '绿色食品', '下单得能量']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], '森林集市页面', 3000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在森林集市页面')
      return false
    }
  }
  taskLog('检测到"绿色商品 绿色快消 绿色食品 下单得能量"，确认在森林集市页面')
  return true
}

/**
 * 判断是否在蚂蚁森林首页（需同时找到"蚂蚁森林"和"森林广场"）
 * @returns {boolean} 是否在蚂蚁森林首页
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

// ============ 任务执行器 ============

/**
 * 检测"任务已完成.*立即领取"，检测到后不断上滑直到出现"可领取"（完全匹配），
 * 点击"可领取"领取奖励，再等待"奖励已发放.*蚂蚁森林收取"消失（领取完成）
 * @returns {boolean} 是否检测到并处理了任务完成
 */
function checkAndClickIfTaskEnd () {
  if (widgetUtils.widgetWaiting('任务已完成.*立即领取', '任务完成', 1000)) {
    sleep(1000)
    // 不断上滑，直到检测到"可领取"（完全匹配）
    let maxScroll = 10
    while (maxScroll-- > 0) {
      let result = widgetInspector.detectAllNodesVisible()
      let hasClaim = result.nodes.some(function (n) { return n.text === '可领取' })
      if (hasClaim) {
        taskLog('检测到"可领取"，点击领取')
        findAndClickByTextVisible(/^可领取$/)
        sleep(5000)
        // 等待"奖励已发放.*蚂蚁森林收取"消失（领取完成、提示关闭）
        while (widgetUtils.widgetWaiting('奖励已发放.*蚂蚁森林收取', '奖励已发放', 1000)) {
          sleep(1000)
        }
        return true
      }
      // 未检测到"可领取"，上滑
      let h = config.device_height
      automator.randomScrollUp(0.2 * h, 0.3 * h, 0.7 * h, 0.8 * h)
      sleep(500)
    }
    // 上滑多次仍未找到"可领取"，直接返回 true 继续循环
    taskLog('上滑多次未找到"可领取"')
    return true
  }
  return false
}

/**
 * 浏览商品任务：点击 greenItem → 上下滑动8轮 → 上滑到顶 → 判断任务是否完成（while循环，无次数限制）
 */
function BrowserExecutor () {
  taskLog('找到了倒计时控件，开始浏览商品')
  while (widgetUtils.widgetGetOne('浏览商品\\d+s得能量', 1000)) {
    // 只保持在 greenItem 中
    let target = widgetUtils.widgetGetById('greenItem', 1000)
    if (target) {
      target.click()
      sleep(1000)
    }
    // 先下滑再上滑，循环8次
    let scrollRound = 8
    while (scrollRound-- > 0) {
      let h = config.device_height
      // 下滑
      automator.randomScrollDown(0.7 * h, 0.8 * h, 0.2 * h, 0.3 * h)
      sleep(500)
      // 上滑
      automator.randomScrollUp(0.2 * h, 0.3 * h, 0.7 * h, 0.8 * h)
      sleep(500)
    }
    // 8次滑动结束后，上滑到最上面
    let h = config.device_height
    automator.randomScrollUp(0.2 * h, 0.3 * h, 0.7 * h, 0.8 * h)
    sleep(500)
    // 判断任务是否完成
    checkAndClickIfTaskEnd()
  }
}

/**
 * 点击商品任务：点击"到手价|入会价|优惠后|补贴后|天猫加补后|绿色制造|绿色家电|绿色有机"商品 → 返回 → 判断任务是否完成（while循环，无次数限制）
 */
function ClickExecutor () {
  taskLog('点击商品进行浏览')
  while (widgetUtils.widgetGetOne('点击', 1000)) {
    // 每轮点击3次商品
    let clickCount = 3
    while (clickCount-- > 0) {
      if (!clickGoodDetail()) {
        LogFloaty.pushWarningLog('点击商品失败，尝试切换到其他tab')
        let greenfood = widgetUtils.widgetGetById('greenFood', 1000)
        if (greenfood) {
          greenfood.click()
          sleep(1000)
          clickGoodDetail()
        }
      }
    }
    // 3次点击结束后判断任务是否完成
    checkAndClickIfTaskEnd()
  }
}

/**
 * 判断"点击"与"即可获得"是否在同一行（y坐标明确相等）
 * @returns {boolean} 是否同行
 */
function isClickTaskSameLine () {
  let allNodes = widgetInspector.detectAllNodesVisible().nodes
  if (!allNodes || allNodes.length === 0) {
    return false
  }
  let clickY = -1
  for (let node of allNodes) {
    if (node.text === '点击') {
      clickY = node.bounds.centerY()
      break
    }
  }
  if (clickY < 0) {
    return false
  }
  for (let node of allNodes) {
    if (/即可获得/.test(node.text)) {
      if (node.bounds.centerY() === clickY) {
        return true
      }
    }
  }
  return false
}

/**
 * 点击一个商品详情（到手价|入会价|优惠后|补贴后|天猫加补后|绿色制造|绿色家电|绿色有机）并返回
 * @returns {boolean} 是否成功点击商品
 */
function clickGoodDetail () {
  let clickBtn = widgetUtils.widgetGetOne('到手价|入会价|优惠后|补贴后|天猫加补后|绿色制造|绿色家电|绿色有机')
  if (clickBtn) {
    taskLog('随机点击一个商品')
    clickBtn.click()
    sleep(2000)
    goBack()
    return true
  } else {
    LogFloaty.pushErrorLog('未找到可点击商品')
  }
  return false
}

/**
 * 查找并执行任务，返回是否执行了任务
 * 2.1 浏览商品\d+s得能量 → BrowserExecutor，checkAndClickIfTaskEnd 为真后等待2s继续循环
 * 2.2 "点击"与"即可获得"同行 → ClickExecutor，判断任务完成同2.1
 * 2.3 同时检测到"任务已完成.*立即领取"与"可领取" → 点击可领取，等待5s继续循环
 * 2.4 其他情况视为任务完成，返回 false 退出循环
 * @returns {boolean} 是否找到并执行了任务（false 表示任务完成，退出循环）
 */
function findAndExecuteTasks () {
  let allNodes = widgetInspector.detectAllNodesVisible().nodes
  if (!allNodes || allNodes.length === 0) {
    taskLog('未获取到任何可见控件，视为任务完成')
    return false
  }

  // 2.3 同时检测到"任务已完成.*立即领取"与"可领取"，点击可领取，等待5s继续循环
  let hasTaskDone = allNodes.some(function (n) { return /任务已完成.*立即领取/.test(n.text) })
  let hasClaim = allNodes.some(function (n) { return n.text === '可领取' })
  if (hasTaskDone && hasClaim) {
    taskLog('同时检测到"任务已完成.*立即领取"与"可领取"，点击可领取')
    findAndClickByTextVisible(/^可领取$/)
    sleep(5000)
    // 等待"奖励已发放.*蚂蚁森林收取"消失（领取完成、提示关闭）
    while (widgetUtils.widgetWaiting('奖励已发放.*蚂蚁森林收取', '奖励已发放', 1000)) {
      sleep(1000)
    }
    return true
  }

  // 2.1 检测到"浏览商品\d+s得能量" → BrowserExecutor
  for (let node of allNodes) {
    if (/浏览商品\d+s得能量/.test(node.text)) {
      taskLog('检测到"浏览商品\d+s得能量"，执行浏览任务')
      BrowserExecutor()
      // checkAndClickIfTaskEnd 为真（已点击"任务已完成"）后等待2s继续循环
      if (checkAndClickIfTaskEnd()) {
        sleep(2000)
      }
      return true
    }
  }

  // 2.2 检测到"点击"与"即可获得"同行 → ClickExecutor
  if (isClickTaskSameLine()) {
    taskLog('检测到"点击"与"即可获得"同行，执行点击任务')
    ClickExecutor()
    // checkAndClickIfTaskEnd 为真（已点击"任务已完成"）后等待2s继续循环
    if (checkAndClickIfTaskEnd()) {
      sleep(2000)
    }
    return true
  }

  // 2.4 其他情况视为任务完成
  taskLog('未匹配到任何任务，任务已完成')
  return false
}

// ============ 收取能量 ============

/**
 * 进入蚂蚁森林
 * @returns {boolean} 是否成功进入
 */
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

  if (waitCount >= 10) {
    errorInfo('进入蚂蚁森林失败')
    return false
  }
  taskLog('进入蚂蚁森林成功')
  return true
}

/**
 * 收取自己的能量（参考复活能量 collectOwnEnergy，使用 BaseScanner）
 */
function collectOwnEnergy () {
  if (config.not_collect_self) {
    debugInfo('配置为不收取自己能量，跳过')
    return
  }
  taskLog('收取自己的能量')

  // 使用 BaseScanner 收取能量
  let ReviveBaseScanner = require('../core/BaseScanner.js')
  let scanner = new ReviveBaseScanner()
  scanner.collectEnergy(true)
}

// ============ 主流程 ============

function main () {
  infoLog('森林集市脚本启动', true)

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

  taskLog('====== 开始森林集市流程 ======')

  // 步骤1：打开森林集市并判断是否在页面（失败直接退出，不重试）
  taskLog('准备打开森林集市')
  if (!enterMarket()) {
    errorInfo('打开森林集市界面失败，退出脚本')
    exitScript()
  }
  // 关闭首购红包弹窗，如果识别到则重新进入森林集市
  closeFirstPurchaseRedPack()
  // 判断是否在森林集市页面，不在则退出
  if (!isOnMarketPage()) {
    errorInfo('不在森林集市页面，退出脚本')
    exitScript()
  }

  // 步骤2：始终为真的 while 循环执行任务
  taskLog('开始执行森林集市任务')
  while (true) {
    if (!findAndExecuteTasks()) {
      // 2.4 其他情况视为任务完成，退出循环
      taskLog('任务已完成，退出任务循环')
      break
    }
  }

  // 步骤3：打开蚂蚁森林收取能量（循环4次）
  taskLog('进入蚂蚁森林收取能量')
  if (!enterAntForest()) {
    errorInfo('进入蚂蚁森林失败')
    exitScript()
  }
  if (!isOnAntForestPage()) {
    errorInfo('不在蚂蚁森林主页')
    exitScript()
  }
  for (let i = 1; i <= 4; i++) {
    taskLog('第' + i + '/4次收自己能量')
    collectOwnEnergy()
    if (i < 4) sleep(5000)
  }

  taskLog('森林集市流程完成')
  exitScript()
}

main()
