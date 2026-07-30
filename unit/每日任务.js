/*
 * 自动执行每日任务
 * 1. 打开蚂蚁森林 → 点击"领奖励"
 * 2. 判断是否在领奖励页面（widgetUtils.widgetWaiting 我的活力值 关闭奖励弹窗 10s）
 *    不在则重新打开蚂蚁森林进入领奖励页面，最多尝试3次，否则失败
 * 3. 领奖励与去抽奖采用 findAndClickByTextVisible 点击，不限制次数，去抽奖有额外抽奖操作
 * 4. 探索任务：widgetInspector.detectAllNodesVisible 匹配所有控件
 *    完全匹配6个关键按钮（必须是按钮），检查排除项同行则跳过
 *    判断是否为特殊任务，走对应分支
 *    普通任务描述固定为"普通任务"
 *    任务完成后类似 waitForGameComplete：先back，检查"我的活力值"关闭奖励弹窗3s，共5次
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

function killApps () {
  try {
    let killSuccess = killProcessUtil.kill(config.package_name || 'com.eg.android.AlipayGphone')
    taskLog('支付宝 → ' + (killSuccess ? '✓ 已杀掉' : '✗ 失败'))
  } catch (e) {
    taskLog('支付宝 → ✗ 失败: ' + e)
  }
}

runningQueueDispatcher.addRunningTask()

function taskLog (msg) {
  LogFloaty.pushLog(msg)
}

if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  commonFunction.minimize()
  sleep(500)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

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
  if (findAndClickByTextVisible(/^立即抽奖$/)) {
    sleep(1500)
    return true
  }
  return false
}

function clickCollectReward () {
  taskLog('查找"收下奖励"按钮')
  sleep(1000)
  if (findAndClickByTextVisible(/^收下奖励$/)) {
    sleep(1500)
    return true
  }
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
    sleep(3000)
    if (clickImmediateLottery()) {
      sleep(2000)
      clickCollectReward()
    }
  }
}

function isOnRewardPage () {
  let result = widgetUtils.widgetWaiting('我的活力值', 10000)
  if (!result) {
    taskLog('未检测到"我的活力值"，不在领奖励页面')
    return false
  }
  let closeResult = widgetUtils.widgetWaiting('关闭奖励弹窗', 3000)
  if (!closeResult) {
    taskLog('未检测到"关闭奖励弹窗"，不在领奖励页面')
    return false
  }
  taskLog('检测到"我的活力值"和"关闭奖励弹窗"，确认在领奖励页面')
  return true
}

/**
 * 进入领奖励页面（与乐园任务步骤2进入乐园一致，使用OCR）
 * 最多尝试3次，每次重新打开蚂蚁森林
 */
function enterRewardPage () {
  for (let attempt = 0; attempt < 3; attempt++) {
    taskLog('尝试进入领奖励页面，第' + (attempt + 1) + '次')
    openAntForest()
    taskLog('查找领奖励入口')
    if (!clickByOcr('领奖励', 5000)) {
      taskLog('OCR未找到领奖励入口')
      continue
    }
    sleep(3000)
    if (isOnRewardPage()) {
      taskLog('成功进入领奖励页面')
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

function handlePopupDialog () {
  taskLog('检查是否有弹窗')
  sleep(500)
  let openBtn = widgetUtils.widgetGetOne(/^打开$/, 2000)
  if (openBtn) {
    taskLog('检测到系统弹窗，点击"打开"')
    automator.clickCenter(openBtn)
    sleep(1500)
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
        sleep(1500)
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
  { keyword: '逛一逛点淘得红包', waitTime: 15000, action: 'clickTarget', clickTarget: '点击领元宝' },
  { keyword: '每日浇水领真绿植', waitTime: 0, action: 'scroll16' },
  { keyword: '逛惊喜市集领红包', waitTime: 15000, action: 'scroll8' },
  { keyword: '逛一逛芝麻树兑绿植', waitTime: 15000, action: 'scroll8' }
]

const SKIP_KEYWORDS = ['玩一场能量雨', '添加1份看病保障', '去淘宝看科普视频', '去蚂蚁阿福健康问答', '添加小荷包能量插件']

const EXPLORE_BUTTONS = ['逛一逛', '去看看', '去参与', '去领取', '去守护', '去完成']

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
          if (text.indexOf('逛一逛飞猪') >= 0) {
            taskLog('附近有"' + text + '"任务，等待25秒')
            return 25000
          }
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
    let result = widgetInspector.detectAllNodesVisible()
    for (let node of result.nodes) {
      if (node.text === specialTask.clickTarget) {
        let bd = node.bounds
        if (bd) {
          taskLog('找到"' + specialTask.clickTarget + '": 点击: (' + bd.centerX() + ', ' + bd.centerY() + ')')
          automator.click(bd.centerX(), bd.centerY())
          found = true
          break
        }
      }
    }
    if (!found) {
      taskLog('控件未找到"' + specialTask.clickTarget + '"')
    }
  } else if (specialTask.action === 'scroll16') {
    taskLog('执行' + specialTask.keyword + '，检查弹窗')
    for (let i = 0; i < 7; i++) {
      sleep(2000)
      let btn = widgetUtils.widgetGetOne('去逛逛', 1000)
      if (btn) {
        taskLog('找到"去逛逛"，点击')
        automator.clickCenter(btn)
        sleep(1000)
        break
      }
    }
    for (let i = 0; i < 2; i++) {
      sleep(2000)
      let btn = widgetUtils.widgetGetOne('立即使用', 1000)
      if (btn) {
        taskLog('找到"立即使用"，点击')
        automator.clickCenter(btn)
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

function waitForTaskComplete () {
  taskLog('任务完成，退出页面')
  sleep(2000)

  for (let i = 0; i < 5; i++) {
    goBack()
    sleep(2000)

    let result = widgetUtils.widgetWaiting('我的活力值', 3000)
    if (result) {
      let closeResult = widgetUtils.widgetWaiting('关闭奖励弹窗', 2000)
      if (closeResult) {
        taskLog('检测到"我的活力值"和"关闭奖励弹窗"，已回到领奖励页面')
        return true
      }
    }
    taskLog('第' + (i + 1) + '次back未回到领奖励页面')
  }

  taskLog('未能回到领奖励页面，重新进入')
  commonFunction.minimize()
  sleep(500)
  openAntForest()
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
    commonFunction.minimize()
    sleep(500)
    killApps()
    sleep(1000)
    runningQueueDispatcher.removeRunningTask()
    exit()
  }

  // 2. 主循环
  let maxRounds = 40
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
      openAntForest()
      if (enterRewardPage()) {
        continue
      }
      break
    }

    taskLog('没有更多任务可执行，退出每日任务')
    break
  }

  taskLog('每日任务完成，返回原页面')
  commonFunction.minimize()
  sleep(500)
  killApps()
  sleep(1000)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

main()
