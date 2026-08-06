/*
 * 自动执行每日任务
 * 1. 打开蚂蚁森林 → 点击"领奖励"（优先模板匹配 sign_reward_icon，OCR 兜底）
 * 2. 判断是否在领奖励页面（widgetUtils.widgetWaiting 我的活力值 关闭奖励弹窗 3s）
 *    不在则重新打开蚂蚁森林进入领奖励页面，最多尝试3次，否则失败
 * 3. 领奖励与去抽奖采用 findAndClickByTextVisible 点击，不限制次数，去抽奖有额外抽奖操作
 * 4. 探索任务：widgetInspector.detectAllNodesVisible 匹配所有控件
 *    完全匹配探索任务按钮（EXPLORE_BUTTONS，含"一键浇水"等特殊任务按钮），检查排除项同行则跳过
 *    判断是否为特殊任务，走对应分支；否则走普通任务分支
 *    特殊任务按 waitTime 等待，普通任务按同行关键词等待（默认2s，长等待15s）
 *    特殊任务 clickTarget 分支：控件优先识别，OCR 兜底
 *    任务完成后类似 waitForTaskComplete：先检测当前包，不在支付宝则切入，再先检测后back
 *    失败则重新进入蚂蚁森林-领奖励-继续执行任务
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
let OpenCvUtil = require('../lib/OpenCvUtil.js')

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

runningQueueDispatcher.addRunningTask()

function taskLog (msg) {
  LogFloaty.pushLog(msg)
}

/**
 * 结束每日任务：返回原页面并清理（与乐园任务 exitScript 一致）
 */
function exitScript () {
  commonFunction.minimize()
  sleep(500)
  killApps()
  sleep(500)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exitScript()
}

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

function goBack () {
  back()
  sleep(800)
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

function clickImmediateLottery () {
  taskLog('查找"立即抽奖"按钮')
  sleep(2000)
  // OCR优先识别（复用clickByOcr，带重试）
  if (clickByOcr('立即抽奖', 3000)) {
    sleep(2000)
    return true
  }
  // 控件兜底
  if (findAndClickByTextVisible(/^立即抽奖$/)) {
    sleep(2000)
    return true
  }
  // 返回false有两种情况：1.真的没有弹窗（纯领取完成）2.有弹窗但OCR/控件都没识别到（弹窗残留）
  taskLog('未找到"立即抽奖"，可能无弹窗或识别失败')
  return false
}

function clickCollectReward () {
  taskLog('查找"收下奖励"按钮')
  sleep(1000)
  // OCR优先识别（复用clickByOcr，带重试）
  if (clickByOcr('收下奖励', 3000)) {
    sleep(2000)
    return true
  }
  // 控件兜底
  if (findAndClickByTextVisible(/^收下奖励$/)) {
    sleep(2000)
    return true
  }
  // 返回false有两种情况：1.真的没有收下奖励 2.有但OCR/控件都没识别到
  taskLog('未找到"收下奖励"')
  return false
}

function claimAllRewards () {
  while (findAndClickByTextVisible(/^立即领取$/)) {
    sleep(2000)
    if (clickImmediateLottery()) {
      sleep(2000)
      clickCollectReward()
    } else {
      taskLog('立即领取完成（纯领取，无弹窗）')
    }
  }
}

function claimAllLotteries () {
  while (findAndClickByTextVisible(/^去抽奖$/)) {
    sleep(2000)
    if (clickImmediateLottery()) {
      sleep(2000)
      clickCollectReward()
    }
  }
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
 * 进入领奖励页面
 * 最多尝试3次，每次重新打开蚂蚁森林
 */
function enterRewardPage () {
  for (let attempt = 0; attempt < 3; attempt++) {
    taskLog('尝试进入领奖励页面，第' + (attempt + 1) + '次')
    if (!openAntForest()) {
      taskLog('进入蚂蚁森林失败')
      continue
    }
    // 进入蚂蚁森林后，先判断是否在蚂蚁森林首页，然后等待2s
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
      return true
    }
    taskLog('未进入领奖励页面，准备重试')
  }
  errorInfo('无法进入领奖励页面，已尝试3次')
  return false
}

/**
 * 通用OCR识别并点击指定关键字（带重试），与乐园任务一致
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

const SPECIAL_TASKS = [
  { keyword: '逛一逛点淘得红包', waitTime: 15000, action: 'clickTarget', clickTarget: '打开APP' },
  { keyword: '每日浇水领真绿植', waitTime: 0, action: 'scroll16' },
  { keyword: '逛惊喜市集领红包', waitTime: 15000, action: 'scroll8' },
  { keyword: '逛一逛芝麻树兑绿植', waitTime: 15000, action: 'scroll8' },
  { keyword: '给随机好友一键浇水', waitTime: 0, action: 'clickTarget', clickTarget: '送给TA' }
]

const SKIP_KEYWORDS = ['玩一场能量雨', '添加1份看病保障', '去淘宝看科普视频', '去蚂蚁阿福健康问答', '添加小荷包能量插件']

const EXPLORE_BUTTONS = ['逛一逛', '去看看', '去参与', '去领取', '去守护', '去完成', '去逛逛', '一键浇水']

const LONG_WAIT_KEYWORDS = ['玩一玩', '获取更多森林资讯', '看15s直播得能量', '逛一逛飞猪']

function findKeywordInSameRow (allNodes, centerY, keywords, matchMode) {
  matchMode = matchMode || 'indexOf'
  for (let node of allNodes) {
    let text = node.text
    if (!text) continue
    for (let kw of keywords) {
      let matched = false
      if (matchMode === 'exact') {
        matched = (text === kw)
      } else {
        matched = (text.indexOf(kw) >= 0)
      }
      if (matched) {
        let y = node.bounds.centerY()
        if (Math.abs(y - centerY) < 200) {
          return kw
        }
      }
    }
  }
  return null
}

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

function getWaitTimeForSameRow (allNodes, centerY) {
  for (let node of allNodes) {
    let text = node.text
    if (!text) continue
    for (let kw of LONG_WAIT_KEYWORDS) {
      if (text.indexOf(kw) >= 0) {
        let y = node.bounds.centerY()
        if (Math.abs(y - centerY) < 200) {
          taskLog('附近有"' + text + '"任务，等待15秒')
          return 15000
        }
      }
    }
  }
  return 2000
}

function executeSpecialTask (specialTask) {
  taskLog('执行特殊任务: ' + specialTask.keyword)
  sleep(2000)

  if (specialTask.action === 'clickTarget' && specialTask.clickTarget) {
    let found = false
    // 控件优先识别（包含匹配，兼容"下载/打开APP"等带前缀的按钮文字）
    if (findAndClickByTextVisible(new RegExp(specialTask.clickTarget))) {
      found = true
    }
    // OCR兜底（复用clickByOcr，带重试）
    if (!found) {
      if (clickByOcr(specialTask.clickTarget, 3000)) {
        found = true
      }
    }
    if (!found) {
      taskLog('未找到"' + specialTask.clickTarget + '"')
    }
  } else if (specialTask.action === 'scroll16') {
    taskLog('执行' + specialTask.keyword + '，检查弹窗')
    for (let i = 0; i < 7; i++) {
      sleep(2000)
      if (findAndClickByTextVisible(/^去逛逛$/)) {
        taskLog('找到"去逛逛"，点击')
        sleep(1000)
        break
      }
    }
    for (let i = 0; i < 2; i++) {
      sleep(2000)
      if (findAndClickByTextVisible(/^立即使用$/)) {
        taskLog('找到"立即使用"，点击')
        sleep(1000)
        break
      }
    }
    taskLog('执行下滑上滑16次')
    let scrollRound = 16
    while (scrollRound-- > 0) {
      let h = config.device_height
      automator.randomScrollDown(0.7 * h, 0.8 * h, 0.2 * h, 0.3 * h)
      sleep(500)
      automator.randomScrollUp(0.2 * h, 0.3 * h, 0.7 * h, 0.8 * h)
      sleep(500)
    }
  } else if (specialTask.action === 'scroll8') {
    let scrollRound = 8
    taskLog('执行下滑上滑' + scrollRound + '次')
    while (scrollRound-- > 0) {
      let h = config.device_height
      automator.randomScrollDown(0.7 * h, 0.8 * h, 0.2 * h, 0.3 * h)
      sleep(500)
      automator.randomScrollUp(0.2 * h, 0.3 * h, 0.7 * h, 0.8 * h)
      sleep(500)
    }
  }
}

/**
 * 等待任务完成并回到领奖励页面
 * 1. 先检测当前包是否在支付宝，不在则先切入支付宝（参考 lib/SwitchToApp.js）
 * 2. 走返回逻辑：先检测是否在领奖励页面，不在则back，循环直到回到领奖励页面
 * @returns {boolean} 是否成功回到领奖励页面
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
      taskLog('切入支付宝失败，重新进入')
      commonFunction.minimize()
      sleep(500)
      return enterRewardPage()
    }
    sleep(2000)
  }

  // 2. 返回逻辑：先检测后back，循环直到回到领奖励页面
  let maxBacks = 3
  for (let i = 0; i < maxBacks; i++) {
    // 先检测是否已在领奖励页面
    if (isOnRewardPage()) {
      taskLog('已回到领奖励页面')
      return true
    }
    // 不在则back
    taskLog('第' + (i + 1) + '次back')
    goBack()
    sleep(2000)
  }

  taskLog('多次back后仍未回到领奖励页面，重新进入')
  commonFunction.minimize()
  sleep(500)
  return enterRewardPage()
}

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

    let skipKeyword = findKeywordInSameRow(allNodes, centerY, SKIP_KEYWORDS)
    if (skipKeyword) {
      taskLog('跳过"' + skipKeyword + '"行的按钮: "' + text + '"')
      continue
    }

    let specialTask = findSpecialTaskInSameRow(allNodes, centerY)
    let waitTime = getWaitTimeForSameRow(allNodes, centerY)

    taskLog('找到探索任务按钮: "' + text + '" 点击: (' + bd.centerX() + ', ' + bd.centerY() + ')')
    automator.click(bd.centerX(), bd.centerY())
    sleep(2000)

    handlePopupDialog()

    if (specialTask) {
      taskLog('走特殊任务分支: ' + specialTask.keyword)
      executeSpecialTask(specialTask)
      if (specialTask.waitTime > 0) {
        sleep(specialTask.waitTime)
      }
    } else {
      taskLog('走普通任务分支')
      sleep(waitTime)
    }

    taskLog('任务执行完毕，等待回到领奖励页面')
    return waitForTaskComplete()
  }

  taskLog('未找到可执行的探索任务')
  return false
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

  // 1. 打开蚂蚁森林并进入领奖励页面
  if (!enterRewardPage()) {
    errorInfo('无法进入领奖励页面，结束每日任务')
    exitScript()
  }

  // 2. 主循环
  let maxRounds = 50
  for (let round = 0; round < maxRounds; round++) {
    taskLog('=== 每日任务 第 ' + (round + 1) + ' 轮 ===')

    claimAllRewards()
    claimAllLotteries()

    taskLog('尝试探索任务')
    try {
      if (findAndExecuteExploreTask()) {
        taskLog('探索任务执行完毕，继续下一轮')
        continue
      }
    } catch (e) {
      let errMsg = e && e.message ? e.message : e
      errorInfo('探索任务异常: ' + errMsg)
      commonFunction.minimize()
      sleep(500)
      if (enterRewardPage()) {
        continue
      }
      break
    }

    taskLog('没有更多任务可执行，退出每日任务')
    break
  }

  taskLog('每日任务完成，返回原页面')
  exitScript()
}

main()
