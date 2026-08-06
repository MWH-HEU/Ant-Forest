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

// 神奇物种 appId：68687886（与 unit/神奇物种万能卡.js 一致）

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
// 核心逻辑：神奇物种
// ============================================================

// 遍历所有控件，正则匹配文本并点击（参考限时道具兑换 findAndClickByText）
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

// 遍历可见区域内的控件，正则匹配文本并点击（参考限时道具兑换 findAndClickByTextVisible）
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

// 打开进入神奇物种的函数
function openMagicSpecies () {
  taskLog('进入神奇物种')

  commonFunction.backHomeIfInVideoPackage()

  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=68687886',
    packageName: config.package_name
  })

  // 处理"打开"确认弹窗
  let confirm = widgetUtils.widgetGetOne(/^打开$/, 1000)
  if (confirm) {
    automator.clickCenter(confirm)
  }

  commonFunction.readyForAlipayWidgets()

  // 等待进入神奇物种页面
  sleep(2000)
  if (!isOnMagicSpeciesPage()) {
    LogFloaty.pushErrorLog('不在神奇物种页面，退出脚本')
    return false
  }
  taskLog('进入神奇物种成功')
  return true
}

// 判断是否在神奇物种的函数（参考 isOnBackpackPage，检查文本是"奖励 当前图鉴 抽好友卡片"）
function isOnMagicSpeciesPage () {
  let texts = ['奖励', '当前图鉴', '抽好友卡片']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], texts[i], 3000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在神奇物种界面')
      return false
    }
  }
  taskLog('检测到"奖励 当前图鉴 抽好友卡片"，确认在神奇物种界面')
  sleep(2000) // 等待界面加载完成
  return true
}

// 判断是否在好友的卡页面（判断文本是"好友的卡" "点击抽卡"）
function isOnFriendCardPage () {
  let texts = ['好友的卡', '点击抽卡']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], texts[i], 3000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在好友的卡页面')
      return false
    }
  }
  taskLog('检测到"好友的卡 点击抽卡"，确认在好友的卡页面')
  sleep(2000) // 等待界面加载完成
  return true
}

// 判断是否在交换页面（文本是"你将获得" "你将换出"）
function isOnExchangePage () {
  let texts = ['你将获得', '你将换出']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], texts[i], 3000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在交换页面')
      return false
    }
  }
  taskLog('检测到"你将获得 你将换出"，确认在交换页面')
  sleep(2000) // 等待界面加载完成
  return true
}

// 循环尝试点击多个关键词：命中任意一个即返回 true（用于“通知好友|获得交换机会”“普通|稀有|神奇”等多选一场景）
function findAndClickAny (patterns) {
  for (let i = 0; i < patterns.length; i++) {
    if (findAndClickByTextVisible(patterns[i])) {
      return true
    }
  }
  return false
}

// 处理“你还未拥有此物种卡”的交换流程
function doExchangeFlow () {
  taskLog('=== 检测到"你还未拥有此物种卡"，执行交换流程 ===')

  // 通知好友或获得交换机会（点击任何一个），然后点击发送
  if (!findAndClickAny([/^通知好友$/, /^获得交换机会$/])) {
    LogFloaty.pushErrorLog('未找到"通知好友"或"获得交换机会"')
    return false
  }
  sleep(2000)

  // 点击发送
  if (!findAndClickByTextVisible(/^发送$/)) {
    LogFloaty.pushErrorLog('未找到"发送"')
    return false
  }
  sleep(2000)

  // 进入交换页面，判断是否在交换页面
  if (!isOnExchangePage()) {
    LogFloaty.pushErrorLog('未进入交换页面')
    return false
  }

  // 点击"普通 稀有 神奇"任何一个
  if (!findAndClickAny([/^普通$/, /^稀有$/, /^神奇$/])) {
    LogFloaty.pushErrorLog('未找到"普通/稀有/神奇"')
    return false
  }
  sleep(2000)

  // 点击"交换"
  if (!findAndClickByTextVisible(/^交换$/)) {
    LogFloaty.pushErrorLog('未找到"交换"')
    return false
  }
  sleep(2000)

  // 点击"确认交换"
  if (!findAndClickByTextVisible(/^确认交换$/)) {
    LogFloaty.pushErrorLog('未找到"确认交换"')
    return false
  }
  sleep(2000)

  // 点击"继续抽卡"
  if (!findAndClickByTextVisible(/^继续抽卡$/)) {
    LogFloaty.pushErrorLog('未找到"继续抽卡"')
    return false
  }
  sleep(2000)
  return true
}

// 处理"你已拥有"的放弃流程
function doGiveUpFlow () {
  taskLog('=== 检测到"你已拥有"，执行放弃流程 ===')

  // 点击放弃
  if (!findAndClickByTextVisible(/^放弃$/)) {
    LogFloaty.pushErrorLog('未找到"放弃"')
    return false
  }
  sleep(2000)

  // 点击"确认放弃"
  if (!findAndClickByTextVisible(/^确认放弃$/)) {
    LogFloaty.pushErrorLog('未找到"确认放弃"')
    return false
  }
  sleep(2000)
  return true
}

// 判断今日剩余次数是否为0（完全匹配"今日次数：N"，冒号后允许有空格）
function isTodayCountZero () {
  let result = widgetInspector.detectAllNodesVisible()
  for (let n of result.nodes) {
    if (n.text && /^今日次数：\s*\d+$/.test(n.text)) {
      let m = n.text.match(/今日次数：\s*(\d+)/)
      if (m && parseInt(m[1], 10) === 0) {
        taskLog('检测到"今日次数：0"，今日次数已用完')
        return true
      }
    }
  }
  return false
}

// 主流程
function main () {
  taskLog('========== 神奇物种 开始 ==========')

  // 进入神奇物种
  if (!openMagicSpecies()) {
    LogFloaty.pushErrorLog('无法进入神奇物种')
    return false
  }

  // 第一次进入：点击"抽好友卡片"进入好友的卡页面（openMagicSpecies 内部已确认在神奇物种页面）
  if (!findAndClickByTextVisible(/^抽好友卡片$/)) {
    LogFloaty.pushErrorLog('未找到"抽好友卡片"')
    return false
  }
  sleep(2000)

  // 循环抽卡，直到今日次数为0（每轮处理完结果后都会回到好友的卡页面）
  while (true) {
    // 判断是否在好友的卡页面，不在则返回重进
    if (!isOnFriendCardPage()) {
      taskLog('不在好友的卡页面，返回重进')
      goBack()
      if (!isOnMagicSpeciesPage()) {
        taskLog('返回后不在神奇物种页面，重新进入')
        if (!openMagicSpecies()) {
          return false
        }
      }
      sleep(1000)
      if (!findAndClickByTextVisible(/^抽好友卡片$/)) {
        LogFloaty.pushErrorLog('重进后未找到"抽好友卡片"')
        return false
      }
      sleep(2000)
      if (!isOnFriendCardPage()) {
        LogFloaty.pushErrorLog('重进后仍未进入好友的卡页面')
        return false
      }
    }

    // 进入好友的卡页面后，判断今日次数是否为0（"今日次数"文本在此页面出现），是则退出循环
    if (isTodayCountZero()) {
      taskLog('今日次数已用完，退出循环')
      break
    }

    // 点击"点击抽卡"
    if (!findAndClickByTextVisible(/^点击抽卡$/)) {
      LogFloaty.pushErrorLog('未找到"点击抽卡"')
      return false
    }
    sleep(2000)

    // 检查抽卡结果
    let allNodes = widgetInspector.detectAllNodesVisible().nodes
    let hasNotOwned = allNodes.some(function (n) { return /你还未拥有此物种卡/.test(n.text) })
    let hasOwned = allNodes.some(function (n) { return /你已拥有：\d+张/.test(n.text) })

    if (hasNotOwned) {
      // 未拥有：执行交换流程
      if (!doExchangeFlow()) {
        LogFloaty.pushErrorLog('交换流程失败')
        return false
      }
    } else if (hasOwned) {
      // 已拥有：执行放弃流程
      if (!doGiveUpFlow()) {
        LogFloaty.pushErrorLog('放弃流程失败')
        return false
      }
    } else {
      taskLog('未检测到抽卡结果，退出循环')
      break
    }

    // 循环继续（处理完结果后已回到好友的卡页面）
    taskLog('=== 继续下一轮抽卡 ===')
    sleep(2000)
  }

  taskLog('========== 神奇物种 完成 ==========')
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
  taskLog('自动模式：开始神奇物种')
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
