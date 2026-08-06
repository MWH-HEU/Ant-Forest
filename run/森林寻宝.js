importClass(java.util.concurrent.LinkedBlockingQueue)
importClass(java.util.concurrent.ThreadPoolExecutor)
importClass(java.util.concurrent.TimeUnit)
importClass(java.util.concurrent.CountDownLatch)
importClass(java.util.concurrent.ThreadFactory)
importClass(java.util.concurrent.Executors)

let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let sRequire = require('../lib/SingletonRequirer.js')(runtime, global)
let automator = sRequire('Automator')
let { debugInfo, warnInfo, errorInfo, infoLog } = sRequire('LogUtils')
let commonFunction = sRequire('CommonFunction')
let widgetUtils = sRequire('WidgetUtils')
let LogFloaty = sRequire('LogFloaty')
let localOcrUtil = require('../lib/LocalOcrUtil.js')
let killProcessUtil = require('../lib/KillProcessUtil.js')
let widgetInspector = require('../lib/WidgetInspector.js')(runtime, global)
let OpenCvUtil = require('../lib/OpenCvUtil.js')
let SwitchToApp = require('../lib/SwitchToApp.js')(runtime, global)

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
 * 结束森林寻宝：返回原页面并清理（与每日任务 exitScript 一致）
 */
function exitScript () {
  commonFunction.minimize()
  sleep(500)
  killApps()
  sleep(500)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

let runningQueueDispatcher = sRequire('RunningQueueDispatcher')
runningQueueDispatcher.addRunningTask()

if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exitScript()
}

function sleepIfNeeded (time) {
  if (time > 0) {
    sleep(time)
  }
}

// 打开蚂蚁森林首页
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

function isOnRewardPage () {
  let result = widgetUtils.widgetWaiting('我的活力值', '领奖励页面', 3000)
  if (!result) {
    taskLog('未检测到"我的活力值"，不在领奖励页面')
    return false
  }
  let closeResult = widgetUtils.widgetWaiting('关闭奖励弹窗', '领奖励页面', 3000)
  if (!closeResult) {
    taskLog('未检测到"关闭奖励弹窗"，不在领奖励页面')
    return false
  }
  taskLog('检测到"我的活力值"和"关闭奖励弹窗"，确认在领奖励页面')
  return true
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
 * 通用OCR识别并点击指定关键字（带重试），与每日任务一致
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
 * 点击"领奖励"入口
 * 优先使用模板图片匹配（sign_reward_icon），模板未配置或匹配失败时回退到OCR识别
 * @returns {boolean} 是否成功点击了"领奖励"
 */
function clickSignReward () {
  taskLog('点击"领奖励"')
  sleep(2000)

  // 方案1：模板图片匹配（优先）
  if (config.image_config && config.image_config.sign_reward_icon) {
    try {
      let screen = commonFunction.captureScreen()
      if (screen) {
        let match = OpenCvUtil.findByGrayBase64(screen, config.image_config.sign_reward_icon, false)
        if (match) {
          let centerX = Math.round(match.centerX())
          let centerY = Math.round(match.centerY())
          taskLog('模板匹配找到"领奖励": 点击: (' + centerX + ', ' + centerY + ')')
          automator.click(centerX, centerY)
          sleep(2000)
          return true
        }
        taskLog('模板匹配未找到"领奖励"，回退到OCR')
      } else {
        taskLog('截屏失败，回退到OCR')
      }
    } catch (e) {
      taskLog('模板匹配异常: ' + e + '，回退到OCR')
    }
  } else {
    taskLog('未配置sign_reward_icon模板，使用OCR')
  }

  // 方案2：OCR识别（兜底）
  taskLog('通过OCR识别"领奖励"')
  if (clickByOcr('领奖励', 5000)) {
    return true
  }

  taskLog('未找到"领奖励"入口')
  return false
}

function handlePopupDialog () {
  taskLog('检查是否有弹窗')
  sleep(500)
  let openBtn = widgetUtils.widgetGetOne(/^打开$/, 2000)
  if (openBtn) {
    taskLog('检测到系统弹窗，点击"打开"')
    automator.clickCenter(openBtn)
    sleep(2000)
    return true
  }
  try {
    let allTextViews = className('android.widget.TextView').find()
    if (allTextViews) {
      let hasAlipayText = false
      let hasOpenButton = false
      let openButton = null
      for (let i = 0; i < allTextViews.size(); i++) {
        let tv = allTextViews.get(i)
        try {
          let t = tv.text()
          if (t) {
            let text = t.toString()
            if (text.indexOf('支付宝') >= 0 && text.indexOf('打开') >= 0) {
              hasAlipayText = true
            }
            if (text === '打开') {
              hasOpenButton = true
              openButton = tv
            }
          }
        } catch (e) {}
      }
      if (hasAlipayText && hasOpenButton && openButton) {
        taskLog('检测到"支付宝想要打开xxx"弹窗，点击"打开"')
        automator.clickCenter(openButton)
        sleep(2000)
        return true
      }
    }
  } catch (e) {
    taskLog('检查弹窗异常: ' + e)
  }
  taskLog('未检测到弹窗')
  return false
}

/**
 * 判断是否在森林寻宝界面
 * 需同时完全匹配"抽奖明细"与"一键连抽"两个文本
 * @returns {boolean}
 */
function isOnForestHuntPage () {
  let texts = ['抽奖明细', '一键连抽']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], '森林寻宝页面', 3000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在森林寻宝界面')
      return false
    }
  }
  taskLog('检测到"抽奖明细 一键连抽"，确认在森林寻宝界面')
  return true
}

/**
 * 进入森林寻宝页面
 * 流程：openAntForest → isOnAntForestPage → clickSignReward → isOnRewardPage
 *      → 通过"我的活力值"center反推点击进入森林寻宝 → 判断是否在森林寻宝界面
 * 最多尝试3次
 * @returns {boolean}
 */
function enterForestHuntPage () {
  let enteredReward = false
  for (let attempt = 0; attempt < 3; attempt++) {
    taskLog('尝试进入领奖励页面，第' + (attempt + 1) + '次')
    if (!openAntForest()) {
      taskLog('进入蚂蚁森林失败')
      continue
    }
    if (!isOnAntForestPage()) {
      taskLog('不在蚂蚁森林首页')
      continue
    }
    sleep(2000)
    taskLog('查找领奖励入口')
    if (!clickSignReward()) {
      taskLog('未找到领奖励入口')
      continue
    }
    sleep(2000)
    if (isOnRewardPage()) {
      taskLog('成功进入领奖励页面')
      sleep(2000)
      enteredReward = true
      break
    }
    taskLog('未进入领奖励页面，准备重试')
  }

  if (!enteredReward) {
    errorInfo('无法进入领奖励页面，已尝试3次')
    return false
  }

  // 通过"我的活力值"反推进入森林寻宝
  taskLog('通过"我的活力值"反推进入森林寻宝')
  let vitality = widgetUtils.widgetGetOne('我的活力值', 2000)
  if (!vitality) {
    taskLog('未找到"我的活力值"')
    return false
  }
  let bounds = vitality.bounds()
  let clickX = config.device_width - bounds.centerX()
  let clickY = bounds.centerY()
  taskLog('"我的活力值" center: (' + bounds.centerX() + ', ' + bounds.centerY() + ')，点击反推位置: (' + clickX + ', ' + clickY + ')')
  automator.click(clickX, clickY)
  sleep(3000)

  // 判断是否在森林寻宝界面
  if (!isOnForestHuntPage()) {
    taskLog('未进入森林寻宝界面')
    return false
  }
  taskLog('已进入森林寻宝页面')
  return true
}

// 返回上一页，等待2s
function goBack () {
  back()
  sleep(2000)
}

/**
 * 等待任务完成并回到森林寻宝界面
 * 1. 先检测当前包是否在支付宝，不在则先切入支付宝（参考 lib/SwitchToApp.js）
 * 2. 走返回逻辑：先检测是否在森林寻宝界面，不在则back，循环直到回到森林寻宝界面
 * 3. 切入失败或多次back失败，重新进入森林寻宝
 * @returns {boolean} 是否成功回到森林寻宝界面
 */
function waitForTaskComplete () {
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
      taskLog('切入支付宝失败，重新进入森林寻宝')
      commonFunction.minimize()
      sleep(500)
      return enterForestHuntPage()
    }
    sleep(2000)
  }

  // 2. 返回逻辑：先检测后back，循环直到回到森林寻宝界面
  let maxBacks = 3
  for (let i = 0; i < maxBacks; i++) {
    // 先检测是否已在森林寻宝界面
    if (isOnForestHuntPage()) {
      taskLog('已回到森林寻宝界面')
      return true
    }
    // 不在则back
    taskLog('第' + (i + 1) + '次back')
    goBack()
    sleep(2000)
  }

  taskLog('多次back后仍未回到森林寻宝界面，重新进入')
  commonFunction.minimize()
  sleep(500)
  return enterForestHuntPage()
}

// 探索任务按钮（完全匹配）
const EXPLORE_BUTTONS = ['去逛逛', '马上玩', '去支持', '去报名', '逛一逛']
// 排除项：部分文本匹配，如"玩游戏得2次机会"
const SKIP_KEYWORDS = ['玩游戏']

// 签到：完全匹配"签到"，反复点击
function claimSignIn () {
  while (findAndClickByTextVisible(/^签到$/)) {
    sleep(2000)
  }
}

// 去兑换：完全匹配"去兑换"，处理确认弹窗
function claimExchange () {
  while (findAndClickByTextVisible(/^去兑换$/)) {
    sleep(2000)
    findAndClickByTextVisible(/^确认兑换$/)
    sleep(2000)
  }
}

// 领取奖励：完全匹配"领取"，反复点击
function claimReward () {
  while (findAndClickByTextVisible(/^领取$/)) {
    sleep(2000)
  }
}

// 判断同行任务类型：浏览市集\d+s / 浏览\d+s / 其他
function classifyTask (allNodes, centerY) {
  for (let node of allNodes) {
    let text = node.text
    if (!text) continue
    let m = text.match(/浏览市集(\d+)s/)
    if (m && Math.abs(node.bounds.centerY() - centerY) < 100) {
      return { type: 'market' }
    }
    m = text.match(/浏览(\d+)s/)
    if (m && Math.abs(node.bounds.centerY() - centerY) < 100) {
      return { type: 'browse', seconds: parseInt(m[1]) }
    }
  }
  return { type: 'other' }
}

// 浏览市集任务：滑动分支（BrowserExecutor风格，while循环等待任务出现）
function executeMarketBrowse () {
  taskLog('开始自动滑动浏览')
  // while中等待"滑动浏览得抽奖机会"，检测不到则视为任务已完成，退出循环
  while (widgetUtils.widgetGetOne('滑动浏览得抽奖机会', 1000)) {
    // 滑动10轮
    for (let s = 10; s > 0; s--) {
      let start = new Date().getTime()
      LogFloaty.replaceLastLog('等待倒计时结束 剩余：' + s + 's')
      if (s % 2 == 0) {
        automator.randomScrollDown()
      } else {
        automator.randomScrollUp()
      }
      // 每次滑动后检查弹窗（用OCR识别"放弃奖励"，短超时控制阻塞）
      clickByOcr('放弃奖励', 800)
      sleepIfNeeded(1000 - (new Date().getTime() - start))
    }
    // 滑动结束后再检查一次弹窗（用OCR识别"放弃奖励"）
    taskLog('检查是否有弹窗需要关闭')
    clickByOcr('放弃奖励', 2000)
    // 下一轮while会重新检测"滑动浏览得抽奖机会"，检测不到则退出（视为已完成）
  }
}

// 浏览\d+s 任务：等待 d+1s，执行完 goBack
function executeTimedBrowse (seconds) {
  let waitTime = (seconds + 1) * 1000
  taskLog('浏览 ' + seconds + 's 任务，实际等待 ' + (seconds + 1) + 's')
  sleep(waitTime)
}

// 查找同行内是否命中排除项（逐节点判断，阈值100）
// 返回命中的节点文本，未命中返回 null
function findSkipInSameRow (allNodes, centerY, keywords) {
  for (let node of allNodes) {
    let text = node.text
    if (!text) continue
    for (let kw of keywords) {
      if (text.indexOf(kw) >= 0) {
        let y = node.bounds.centerY()
        if (Math.abs(y - centerY) < 100) {
          return text
        }
      }
    }
  }
  return null
}

// 查找并执行探索任务：遍历所有节点，匹配 EXPLORE_BUTTONS 按钮，按同行任务类型分发
function findAndExecuteExploreTask () {
  let result = widgetInspector.detectAllNodesVisible()
  let allNodes = result.nodes
  if (!allNodes || allNodes.length === 0) {
    taskLog('未检测到任何控件')
    return false
  }

  // 找到"抽奖明细"的y坐标作为基准线，只处理其下方的按钮/文本
  let detailY = -1
  for (let n of allNodes) {
    if (n.text === '抽奖明细') {
      detailY = n.bounds.centerY()
      break
    }
  }
  if (detailY < 0) {
    taskLog('未找到"抽奖明细"，不限制任务区域，处理所有按钮')
  }

  for (let node of allNodes) {
    let text = node.text
    if (!text) continue

    // 只处理"抽奖明细"下方的按钮/文本，在其上方则跳过
    let centerY = node.bounds.centerY()
    if (centerY < detailY) {
      taskLog('按钮在"抽奖明细"上方，跳过: "' + text + '"')
      continue
    }

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

    // 排除项：同行含"玩游戏"则跳过（逐节点判断，阈值100）
    let skipText = findSkipInSameRow(allNodes, centerY, SKIP_KEYWORDS)
    if (skipText) {
      taskLog('同行含排除项，跳过按钮: "' + text + '"（排除项: ' + skipText + '）')
      continue
    }

    taskLog('找到探索任务按钮: "' + text + '" 点击: (' + bd.centerX() + ', ' + bd.centerY() + ')')
    automator.click(bd.centerX(), bd.centerY())
    sleep(2000)
    handlePopupDialog()

    // 按同行任务类型分发（不是按按钮）
    let cmd = classifyTask(allNodes, centerY)
    if (cmd.type === 'market') {
      taskLog('检测到浏览市集任务，执行滑动分支')
      executeMarketBrowse()
      goBack()
    } else if (cmd.type === 'browse') {
      taskLog('检测到浏览' + cmd.seconds + 's任务，等待' + (cmd.seconds + 1) + 's')
      executeTimedBrowse(cmd.seconds)
      goBack()
    } else {
      taskLog('其他任务，等待2秒后返回')
      sleep(2000)
    }

    taskLog('任务执行完毕，等待回到森林寻宝界面')
    return waitForTaskComplete()
  }

  taskLog('未找到可执行的探索任务')
  return false
}

function doAutoCollect () {
  taskLog('森林集市任务开始')

  // 探索任务循环
  let maxRounds = 10
  for (let round = 0; round < maxRounds; round++) {
    taskLog('=== 森林寻宝 第 ' + (round + 1) + ' 轮 ===')

    // 每轮先执行 3 个独立任务（签到/去兑换/领取奖励）
    claimSignIn()
    claimExchange()
    claimReward()

    if (findAndExecuteExploreTask()) {
      taskLog('探索任务执行完毕，继续下一轮')
      continue
    }
    taskLog('没有更多任务可执行')
    break
  }

  taskLog('森林寻宝任务执行完毕')
  return true
}

function doDraw () {
  // while循环：没抽完就继续抽，直到抽完（"明日再来"或"还有0次机会"或次数为0），最多点击15次
  let drawCount = 0
  while (drawCount < 15) {
    drawCount++
    // 抽完判断1：出现"明日再来"（抽奖机会已用完）
    let tomorrowTarget = widgetUtils.widgetGetOne('明日再来', 1000)
    if (tomorrowTarget) {
      taskLog('检测到"明日再来"，抽奖机会已用完')
      return false
    }

    // 抽完判断2：出现"还有0次机会"（抽奖机会已用完）
    let noChance = widgetUtils.widgetGetOne('还有0次机会', 1000)
    if (noChance) {
      taskLog('检测到"还有0次机会"，抽奖机会已用完')
      return false
    }

    // 找"还有"后面的剩余次数（还有机会时是"还有" + \d + "次机会"三个独立节点）
    let target = widgetUtils.widgetGetOne('还有')
    if (!target) {
      taskLog('未找到抽奖按钮')
      return false
    }
    let chance = widgetUtils.subWidgetGetOne(target.parent(), '\\d+', 2000)
    if (!chance) {
      taskLog('未找到剩余次数')
      return false
    }
    let chanceText = chance.text()

    // 抽完判断3：剩余次数为0
    if (!chanceText || chanceText == '0') {
      taskLog('剩余抽奖次数为0，抽奖已结束')
      return false
    }

    // 没抽完 → 点击抽奖
    taskLog('剩余抽奖次数: ' + chanceText + '，点击抽奖')
    automator.clickCenter(chance)
    sleep(3000)

    // 点击后通过OCR识别点击弹窗按钮："继续抽" | "做任务继续抽" | "开心收下"
    if (clickByOcr('继续抽', 3000)) {
      taskLog('点击"继续抽"关闭弹窗')
      sleep(2000)
    } else if (clickByOcr('做任务继续抽', 3000)) {
      taskLog('点击"做任务继续抽"')
      sleep(2000)
    } else if (clickByOcr('开心收下', 3000)) {
      taskLog('点击"开心收下"')
      sleep(2000)
    }

    // 继续循环抽下一次
    sleep(1000)
  }
  // 达到15次上限，视为本次抽奖结束
  return false
}

// 循环下滑，直到检测到"每日24点更新任务列表，未领取的机会会消失哦"停止（参考限时道具脚本）
function scrollUntilEnd () {
  while (true) {
    let allNodes = widgetInspector.detectAllNodesVisible().nodes
    if (!allNodes || allNodes.length === 0) {
      taskLog('未检测到任何控件，停止滑动')
      break
    }
    // 检测到结束文案则停止滑动
    let hasEnd = allNodes.some(function (n) {
      return n.text && n.text.indexOf('每日24点更新任务列表') >= 0
    })
    if (hasEnd) {
      taskLog('检测到"每日24点更新任务列表，未领取的机会会消失哦"，停止滑动')
      break
    }
    automator.gestureDown(Math.round(config.device_height * 0.90), Math.round(config.device_height * 0.70), 300)
    sleep(1000)
  }
}

// 执行当前Tab的完整流程（任务 + 抽奖）
// 返回是否有抽奖机会
function executeTab () {
  doAutoCollect()
  let hasChance = doDraw()
  return hasChance
}

// 执行所有Tab
// 返回是否有抽奖机会
function executeAllTabs () {
  // 检测双Tab并切换到Tab 0（默认界面），最多重试3次
  let eventTabs = null
  for (let retry = 0; retry < 3; retry++) {
    eventTabs = checkHasEvent()
    if (eventTabs && eventTabs.length > 1) {
      taskLog('检测到双Tab，共 ' + eventTabs.length + ' 个')
      // 先切换到Tab 0
      eventTabs[0].click()
      taskLog('切换到Tab 0（默认界面）')
      sleep(1000)
      break
    }
    if (retry < 2) {
      taskLog('未检测到双Tab，等待3秒后重试')
      sleep(3000)
    }
  }

  // 当前Tab循环下滑到任务列表底部（不依赖双Tab检测，检测到"每日24点更新任务列表"停止）
  scrollUntilEnd()

  let hasChance = executeTab()
  if (!hasChance) {
    // Tab0执行完毕（任务+抽奖），切换到Tab1
    for (let retry = 0; retry < 3; retry++) {
      let eventTabs2 = checkHasEvent()
      if (eventTabs2 && eventTabs2.length > 1) {
        eventTabs2[1].click()
        taskLog('切换到Tab 1（活动界面）')
        sleep(1000)
        // 循环下滑到任务列表底部（检测到"每日24点更新任务列表"停止）
        scrollUntilEnd()
        hasChance = executeTab()
        break
      }
      if (retry < 2) {
        taskLog('未检测到Tab1，等待3秒后重试')
        sleep(3000)
      }
    }
  }
  return hasChance
}

function checkHasEvent () {
  let appContainer = widgetUtils.widgetGetById('app')
  if (appContainer) {
    let subContainer = appContainer.child(0)
    if (subContainer) {
      try {
        let eventTabContainer = subContainer.child(1).child(0)
        if (eventTabContainer && eventTabContainer.childCount() > 1) {
          taskLog('检测到双Tab，Tab数量: ' + eventTabContainer.childCount())
          return [eventTabContainer.child(0), eventTabContainer.child(1)]
        }
      } catch (e) {
        console.error(e)
      }
    }
  }
  return false
}

// ============ 主函数 ============

function main () {
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

  // 主流程
  taskLog('森林寻宝脚本启动')
  if (!enterForestHuntPage()) {
    errorInfo('进入森林寻宝失败，结束脚本')
    exitScript()
  }

  executeAllTabs()

  // 返回蚂蚁森林收集页面
  taskLog('任务完成')
  exitScript()
}

// 启动
main()
