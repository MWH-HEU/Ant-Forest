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

// 判断当前可见控件中是否存在匹配文本
function hasTextVisible (pattern) {
  let result = widgetInspector.detectAllNodesVisible()
  for (let node of result.nodes) {
    if (node.text && pattern.test(node.text)) {
      return true
    }
  }
  return false
}

// 返回上一页
function goBack () {
  back()
  sleep(4000)
}

// 打开进入神奇物种的函数
function openMagicSpecies () {
  taskLog('进入神奇物种')

  commonFunction.backHomeIfInVideoPackage()

  // 先杀掉支付宝进程，强制冷启动进入神奇物种主页面（避免停留在好友的卡等子页面）
  killApps()
  sleep(2000)

  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=68687886',
    packageName: config.package_name
  })

  // 处理"打开"确认弹窗
  let confirm = widgetUtils.widgetGetOne(/^打开$/, 10000)
  if (confirm) {
    automator.clickCenter(confirm)
  }


  // 每天第一次进入会自动抽取一张卡片，点击"收下"（可能不是第一次进入，无"收下"则跳过，不退出）
  collectFirstCard()

  // 等待进入神奇物种页面
  sleep(4000)

  if (!isOnMagicSpeciesPage()) {
    LogFloaty.pushErrorLog('不在神奇物种页面，退出脚本')
    return false
  }
  taskLog('进入神奇物种成功')
  return true
}

// 判断是否在神奇物种的函数（参考 isOnBackpackPage，任一文本匹配即视为成功："领抽卡机会 抽好友卡片 抽卡截止日期"）
function isOnMagicSpeciesPage () {
  let texts = ['领抽卡机会', '抽好友卡片', '抽卡截止日期.*']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting('^' + texts[i] + '$', texts[i], 4000)
    if (result) {
      taskLog('检测到"' + texts[i] + '"，确认在神奇物种界面')
      sleep(4000) // 等待界面加载完成
      return true
    }
  }
  taskLog('未检测到"领抽卡机会 抽好友卡片 抽卡截止日期"任一文本，不在神奇物种界面')
  return false
}

// 判断是否在好友的卡页面（任一文本匹配即视为成功："好友的卡" "点击抽卡" "今日次数"）
function isOnFriendCardPage () {
  let texts = ['好友的卡', '点击抽卡', '今日次数.*']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting('^' + texts[i] + '$', texts[i], 4000)
    if (result) {
      taskLog('检测到"' + texts[i] + '"，确认在好友的卡页面')
      sleep(4000) // 等待界面加载完成
      return true
    }
  }
  taskLog('未检测到"好友的卡 点击抽卡 今日次数"任一文本，不在好友的卡页面')
  return false
}

// ============ OCR 识别辅助（新版页面多为图片/无文本控件） ============

// 截屏并OCR识别全部文本，返回 [{label, bounds}]
// 传入 pattern 时按 clickByOcr 的方式限时重试，直到识别到匹配文本（或超时）
function ocrScanAll (pattern, timeout) {
  if (!localOcrUtil.enabled) {
    taskLog('OCR未启用，无法识别')
    return []
  }
  // OCR 前隐藏日志悬浮窗，避免日志文字被识别或遮挡页面
  LogFloaty.hide()
  sleep(300)
  try {
    let deadline = new Date().getTime() + (timeout || 0)
    while (true) {
      commonFunction.requestScreenCaptureOrRestart()
      sleep(1000)
      let results = []
      let screen = commonFunction.captureScreen()
      if (screen) {
        results = localOcrUtil.recognizeWithBounds(screen, null) || []
        screen.recycle()
      } else {
        taskLog('截屏失败')
      }

      if (!pattern) return results
      for (let i = 0; i < results.length; i++) {
        if (pattern.test(results[i].label || '')) return results
      }
      if (new Date().getTime() >= deadline) {
        taskLog('OCR重试超时，未识别到目标文本')
        return results
      }
      sleep(1000)
    }
  } finally {
    // 识别结束恢复日志悬浮窗
    LogFloaty.show()
  }
}

// OCR 判断抽卡结果：'notOwned' | 'owned' | null（限时重试等待弹窗）
function getCardResultType () {
  let results = ocrScanAll(/未拥有|已拥有/, 4000)
  if (!results.length) {
    taskLog('OCR未识别到任何文本')
    return null
  }
  let notOwned = false
  let owned = false
  for (let i = 0; i < results.length; i++) {
    let label = results[i].label || ''
    if (/未拥有/.test(label)) {
      notOwned = true
    } else if (/已拥有/.test(label)) {
      owned = true
    }
  }
  if (notOwned) {
    taskLog('OCR识别到"未拥有"')
    return 'notOwned'
  }
  if (owned) {
    taskLog('OCR识别到"已拥有"')
    return 'owned'
  }
  taskLog('OCR未识别到"未拥有"或"已拥有"')
  return null
}

// 点击锚点文本下方、屏幕水平居中的 OCR 关键词
// keywordRegexes 按顺序尝试；锚点找不到时以屏幕 70% 高度作为锚点
function clickOcrBelowAnchor (keywordRegexes, anchorRegex) {
  // 限时重试，直到目标关键词出现
  let combinedRegex = new RegExp(keywordRegexes.map(function (r) { return r.source }).join('|'))
  let results = ocrScanAll(combinedRegex, 4000)
  if (!results.length) {
    taskLog('OCR未识别到任何文本')
    return false
  }

  let anchorY = null
  for (let i = 0; i < results.length; i++) {
    if (results[i].bounds && anchorRegex.test(results[i].label)) {
      anchorY = results[i].bounds.centerY()
      taskLog('OCR锚点"' + results[i].label + '" Y=' + anchorY)
      break
    }
  }
  if (anchorY === null) {
    anchorY = Math.round(config.device_height * 0.7)
    taskLog('OCR未找到锚点，按屏幕70%高度 Y=' + anchorY)
  }

  for (let k = 0; k < keywordRegexes.length; k++) {
    let best = null
    for (let i = 0; i < results.length; i++) {
      let r = results[i]
      if (!r.bounds) continue
      if (r.bounds.centerY() <= anchorY) continue
      if (!keywordRegexes[k].test(r.label)) continue
      if (!best || r.bounds.centerY() < best.bounds.centerY()) best = r
    }
    if (best) {
      let x = Math.round(config.device_width / 2)
      let y = Math.round(best.bounds.centerY())
      taskLog('OCR找到"' + best.label + '"，点击: (' + x + ', ' + y + ')')
      automator.click(x, y)
      return true
    }
  }
  taskLog('OCR未找到锚点下方的目标关键词')
  return false
}

// ============ 空文本 Button 辅助（新版交换页按钮无文本） ============

// OCR 识别文本并点击其中心（空按钮兜底用）
function clickOcrText (keywordRegex, timeout) {
  let results = ocrScanAll(keywordRegex, timeout)
  if (!results.length) {
    taskLog('OCR兜底未识别到任何文本')
    return false
  }
  for (let i = 0; i < results.length; i++) {
    let r = results[i]
    if (!r.bounds) continue
    if (!keywordRegex.test(r.label || '')) continue
    let x = Math.round(r.bounds.centerX())
    let y = Math.round(r.bounds.centerY())
    taskLog('OCR兜底找到"' + r.label + '"，点击: (' + x + ', ' + y + ')')
    automator.click(x, y)
    sleep(1000)
    return true
  }
  taskLog('OCR兜底未找到目标文本')
  return false
}

// 获取空文本的可点击 Button，默认排除全屏蒙层
function getEmptyButtons (includeFullScreen) {
  let buttons = []
  try {
    let nodes = className('android.widget.Button').clickable().find()
    for (let i = 0; i < nodes.size(); i++) {
      let node = nodes.get(i)
      let text = ''
      let desc = ''
      try { text = node.text() || '' } catch (e) {}
      try { desc = node.desc() || '' } catch (e) {}
      if (text || desc) continue
      let bounds = null
      try { bounds = node.bounds() } catch (e) {}
      if (!bounds) continue
      let fullScreen = (bounds.right - bounds.left) >= config.device_width * 0.9 && (bounds.bottom - bounds.top) >= config.device_height * 0.9
      if (!includeFullScreen && fullScreen) continue
      buttons.push({ node: node, bounds: bounds, centerX: bounds.centerX(), centerY: bounds.centerY(), fullScreen: fullScreen })
    }
  } catch (e) {
    taskLog('获取空按钮异常: ' + e)
  }
  return buttons
}

// 点击"交换"：交换页两个空按钮 y 相同，x 大的是交换
function clickExchangeButton () {
  let buttons = getEmptyButtons(false)
  if (!buttons.length) {
    taskLog('未找到空按钮（交换），改用OCR兜底')
    return clickOcrText(/交换/, 4000)
  }
  let target = buttons[0]
  for (let i = 1; i < buttons.length; i++) {
    if (buttons[i].centerX > target.centerX) target = buttons[i]
  }
  taskLog('点击"交换"空按钮 (' + target.centerX + ', ' + target.centerY + ')，空按钮共' + buttons.length + '个')
  automator.click(target.centerX, target.centerY)
  sleep(4000)
  return true
}

// 点击"好的"：确认交换页4个空按钮，下方一对中 y 小的是好的
function clickGoodButton () {
  let buttons = getEmptyButtons(false)
  if (buttons.length < 2) {
    taskLog('空按钮不足（好的），改用OCR兜底')
    return clickOcrText(/好的/, 4000)
  }
  buttons.sort(function (a, b) { return a.centerY - b.centerY })
  let target = buttons[buttons.length - 2] // 最下方两个中 y 较小的
  taskLog('点击"好的"空按钮 (' + target.centerX + ', ' + target.centerY + ')，空按钮共' + buttons.length + '个')
  automator.click(target.centerX, target.centerY)
  sleep(4000)
  return true
}

// 点击"继续抽卡"：排除全屏蒙层后，y 小的是继续抽卡
function clickContinueDrawButton () {
  let buttons = getEmptyButtons(false)
  if (!buttons.length) {
    taskLog('未找到空按钮（继续抽卡），改用OCR兜底')
    return clickOcrText(/继续抽卡/, 4000)
  }
  buttons.sort(function (a, b) { return a.centerY - b.centerY })
  let target = buttons[0]
  taskLog('点击"继续抽卡"空按钮 (' + target.centerX + ', ' + target.centerY + ')，空按钮共' + buttons.length + '个')
  automator.click(target.centerX, target.centerY)
  sleep(4000)
  return true
}

// 循环尝试点击多个关键词：命中任意一个即返回 true（用于“通知好友|获得交换机会”等多选一场景）
function findAndClickAny (patterns) {
  for (let i = 0; i < patterns.length; i++) {
    if (findAndClickByTextVisible(patterns[i])) {
      return true
    }
  }
  return false
}

// 方案一：点击屏幕宽度20%、高度65%处（用于选择交换卡片）
function clickExchangeCardByPosition () {
  let x = parseInt(config.device_width * 0.2)
  let y = parseInt(config.device_height * 0.65)
  taskLog('方案一：点击屏幕(' + x + ', ' + y + ')')
  automator.click(x, y)
  sleep(4000)
  return true
}

// 方案二：全屏识别纯数字控件，点击最大的数字（新版无"点击选择你要交换的卡片"锚点）
function clickExchangeCardByMaxNumber () {
  let result = widgetInspector.detectAllNodesVisible()

  // 找所有纯数字控件，记录数字最大的
  let maxNum = -1
  let maxNode = null
  for (let n of result.nodes) {
    if (!n.text || !n.bounds) continue
    let m = n.text.match(/^\d+$/)
    if (m) {
      let num = parseInt(m[0], 10)
      if (num > maxNum) {
        maxNum = num
        maxNode = n
      }
    }
  }

  if (maxNode) {
    taskLog('方案二：点击最大数字 ' + maxNum + '，位置：(' + maxNode.bounds.centerX() + ', ' + maxNode.bounds.centerY() + ')')
    automator.click(maxNode.bounds.centerX(), maxNode.bounds.centerY())
    sleep(4000)
    return true
  }

  LogFloaty.pushErrorLog('未找到纯数字控件')
  return false
}

// 处理"未拥有"的交换流程（新版文本改用OCR识别）
function doExchangeFlow () {
  taskLog('=== OCR检测到"未拥有"，执行交换流程 ===')

  // OCR 点击"通知"或"交换"（锚点下方，屏幕水平居中），然后点击发送
  if (!clickOcrBelowAnchor([/通知/, /交换/], /未拥有/)) {
    LogFloaty.pushErrorLog('未找到"通知"或"交换"')
    return false
  }
  sleep(4000)

  // 点击发送（新版仍是文本，无需修改）
  if (!findAndClickByTextVisible(/^发送$/)) {
    LogFloaty.pushErrorLog('未找到"发送"')
    return false
  }
  sleep(4000)

  // 选择交换卡片（优先方案二：点击最大数字；失败则用方案一：点击屏幕固定位置）
  if (!clickExchangeCardByMaxNumber()) {
    taskLog('方案二失败，改用方案一兜底')
    if (!clickExchangeCardByPosition()) {
      LogFloaty.pushErrorLog('方案一兜底点击交换卡片失败')
      return false
    }
  }

  // 点击"交换"（两个空按钮中 x 大的）
  if (!clickExchangeButton()) {
    LogFloaty.pushErrorLog('未找到"交换"按钮')
    return false
  }

  // 点击"好的"（相当于旧版"确认交换"）
  if (!clickGoodButton()) {
    LogFloaty.pushErrorLog('未找到"好的"按钮')
    return false
  }
  sleep(4000)

  // 交换完成后不再点击"继续抽卡"（实测点击后仍停留原页面），直接返回好友的卡页面
  goBack()
  return true
}

// 处理"已拥有"的放弃流程（新版"放弃"改用OCR识别）
function doGiveUpFlow () {
  taskLog('=== OCR检测到"已拥有"，执行放弃流程 ===')

  // OCR 点击"放弃"（锚点"已拥有"下方，屏幕水平居中）
  if (!clickOcrBelowAnchor([/放弃/], /已拥有/)) {
    LogFloaty.pushErrorLog('未找到"放弃"')
    return false
  }
  sleep(4000)

  // 点击"确定放弃"
  if (!findAndClickByTextVisible(/^确定放弃$/)) {
    LogFloaty.pushErrorLog('未找到"确定放弃"')
    return false
  }
  sleep(4000)
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

// 每天第一次进入神奇物种会自动抽取一张卡片，需手动点击"收下"；等待5s后点击，返回 false 不退出（可能不是第一次进入，无"收下"可点）
function collectFirstCard () {
  sleep(5000)
  findAndClickByTextVisible(/^收下$/)
  return false
}

// 集齐卡片后合成勋章：先点首页"数字/数字"进入合成界面，再点 0.1 屏宽/截止日期 y 触发合成
function synthesizeMedal () {
  // 1. 进入合成勋章界面：定位首页"抽好友卡片"锚点，点击其右侧及下方的"数字/数字"（已集齐时两数相等）
  let result = widgetInspector.detectAllNodesVisible()
  let anchor = null
  let homeDateY = null
  for (let n of result.nodes) {
    if (!n.text || !n.bounds) continue
    if (!anchor && /^抽好友卡片$/.test(n.text)) anchor = n
    if (homeDateY === null && /抽卡截止日期.*/.test(n.text)) homeDateY = n.bounds.centerY()
  }

  if (!anchor) {
    LogFloaty.pushErrorLog('未找到"抽好友卡片"锚点，无法进入合成勋章界面')
    return false
  }

  let progressNode = null
  for (let n of result.nodes) {
    if (!n.text || !n.bounds) continue
    if (n === anchor) continue
    if (n.bounds.centerX() <= anchor.bounds.centerX()) continue
    if (n.bounds.centerY() <= anchor.bounds.centerY()) continue
    let m = n.text.match(/^(\d+)\/(\d+)$/)
    if (m && parseInt(m[1], 10) === parseInt(m[2], 10)) {
      progressNode = n
      break
    }
  }

  if (!progressNode) {
    LogFloaty.pushErrorLog('未找到已集齐的"数字/数字"，无法进入合成勋章界面')
    return false
  }

  taskLog('点击首页"' + progressNode.text + '"进入合成勋章界面: (' + progressNode.bounds.centerX() + ', ' + progressNode.bounds.centerY() + ')')
  automator.click(progressNode.bounds.centerX(), progressNode.bounds.centerY())
  sleep(4000)

  // 2. 已进入合成界面：点击 0.1 屏幕宽度，y 取"抽卡截止日期.*"的 y
  let dateY = null
  let pageResult = widgetInspector.detectAllNodesVisible()
  for (let n of pageResult.nodes) {
    if (n.text && /抽卡截止日期.*/.test(n.text) && n.bounds) {
      dateY = n.bounds.centerY()
      break
    }
  }
  if (dateY === null) dateY = homeDateY
  if (dateY === null) {
    LogFloaty.pushErrorLog('未找到"抽卡截止日期.*"的 y，无法继续合成')
    return false
  }

  let x = parseInt(config.device_width * 0.1)
  let y = parseInt(dateY)
  taskLog('合成界面点击 0.1 屏幕宽度: (' + x + ', ' + y + ')')
  automator.click(x, y)
  sleep(4000)

  // 3. 后续流程：等待"点击合成勋章"出现，超时4s，等待后sleep 4s
  widgetUtils.widgetWaiting('^点击合成勋章$', '点击合成勋章', 4000)
  sleep(4000)

  if (!findAndClickByTextVisible(/^点击合成勋章$/)) {
    LogFloaty.pushErrorLog('未找到"点击合成勋章"，异常退出')
    exitScript()
    return false
  }

  // 等待2s后点击"确认"（可能已勾选"下次不提示确认"，弹窗未出现则跳过）
  sleep(2000)
  findAndClickByTextVisible(/^确认$/)

  // 等待"关闭"出现（合成完成），超时4s，完全匹配，等待后sleep 4s
  widgetUtils.widgetWaiting('^关闭$', '关闭', 4000)
  sleep(4000)

  if (!findAndClickByTextVisible(/^关闭$/)) {
    LogFloaty.pushErrorLog('未找到"关闭"，异常退出')
    exitScript()
    return false
  }

  sleep(4000)
  taskLog('合成勋章完成，任务结束')
  return true
}

// 判断是否已集齐卡片：在"抽好友卡片"的右侧及下方匹配"数字/数字"，两数相等则已集齐；已集齐后合成勋章并刮卡
function checkCardCollected () {
  let result = widgetInspector.detectAllNodesVisible()
  let anchor = null // "抽好友卡片" 节点

  for (let n of result.nodes) {
    if (!n.text || !n.bounds) continue
    if (/^抽好友卡片$/.test(n.text)) {
      anchor = n
      break
    }
  }

  if (!anchor) {
    taskLog('未找到"抽好友卡片"锚点，无法判断是否集齐')
    return false
  }

  taskLog('"抽好友卡片"锚点：centerX=' + anchor.bounds.centerX() + '，centerY=' + anchor.bounds.centerY())

  // 在锚点右侧且下方找"数字/数字"文本，且两数相等
  for (let n of result.nodes) {
    if (!n.text || !n.bounds) continue
    if (n === anchor) continue
    let isRight = n.bounds.centerX() > anchor.bounds.centerX()
    let isBelow = n.bounds.centerY() > anchor.bounds.centerY()
    if (!isRight || !isBelow) continue
    let m = n.text.match(/^(\d+)\/(\d+)$/)
    if (m) {
      let a = parseInt(m[1], 10)
      let b = parseInt(m[2], 10)
      taskLog('检测到"' + n.text + '"（X=' + n.bounds.centerX() + '，Y=' + n.bounds.centerY() + '）')
      if (a === b) {
        taskLog('已集齐卡片（' + a + '/' + b + '），任务完成')
        // 集齐后合成勋章
        synthesizeMedal()
        // 合成后刮卡
        doScratchCards()
        return true
      }
    }
  }

  taskLog('未检测到已集齐（两数相等的"数字/数字"）')
  return false
}

// 刮卡得能量：交换完成后重新进入首页，循环刮卡
function doScratchCards () {
  taskLog('=== 检查并刮卡得能量 ===')

  // 重新打开神奇物种，回到首页
  if (!openMagicSpecies()) {
    LogFloaty.pushErrorLog('重新进入神奇物种失败，跳过刮卡')
    return false
  }

  // 「刮卡得能量」仅首页存在，没有则无需刮卡
  if (!hasTextVisible(/^刮卡得能量.*$/)) {
    taskLog('首页无"刮卡得能量"，无需刮卡')
    return true
  }
  if (!findAndClickByTextVisible(/^刮卡得能量.*$/)) {
    taskLog('点击"刮卡得能量"失败')
    return false
  }
  sleep(4000)

  let maxRounds = 30 // 防御死循环
  while (maxRounds-- > 0) {
    let hasClaim = hasTextVisible(/^刮卡领奖$/)
    let hasNext = hasTextVisible(/^刮下一张$/)

    // 既无「刮下一张」也无「刮卡领奖」才结束
    if (!hasClaim && !hasNext) {
      taskLog('既无"刮下一张"也无"刮卡领奖"，刮卡结束')
      break
    }

    // 先点击「刮卡领奖」
    if (hasClaim) {
      if (!findAndClickByTextVisible(/^刮卡领奖$/)) {
        taskLog('点击"刮卡领奖"失败')
        break
      }
      sleep(2000)
    }

    // 有「刮下一张」则继续下一张
    if (findAndClickByTextVisible(/^刮下一张$/)) {
      taskLog('点击"刮下一张"')
      sleep(2000)
      continue
    }
  }
  taskLog('=== 刮卡结束 ===')
  return true
}

// 主流程
function main () {
  taskLog('========== 神奇物种 开始 ==========')

  // 进入神奇物种
  if (!openMagicSpecies()) {
    LogFloaty.pushErrorLog('无法进入神奇物种')
    return false
  }

  // 判断是否已集齐卡片；已集齐则合成勋章并刮卡，然后退出
  if (checkCardCollected()) {
    taskLog('已集齐卡片，任务完成')
    exitScript()
  }

  // 第一次进入：点击"抽好友卡片"进入好友的卡页面（openMagicSpecies 内部已确认在神奇物种页面）
  if (!findAndClickByTextVisible(/^抽好友卡片$/)) {
    LogFloaty.pushErrorLog('未找到"抽好友卡片"')
    return false
  }
  sleep(4000)

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
      sleep(2000)
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
    sleep(6000)

    // 检查抽卡结果（新版文本改用OCR识别）
    let cardResult = getCardResultType()
    if (cardResult === 'notOwned') {
      // 未拥有：执行交换流程
      if (!doExchangeFlow()) {
        LogFloaty.pushErrorLog('交换流程失败')
        return false
      }
    } else if (cardResult === 'owned') {
      // 已拥有：执行放弃流程
      if (!doGiveUpFlow()) {
        LogFloaty.pushErrorLog('放弃流程失败')
        return false
      }
    } else {
      // 未检测到抽卡结果：返回首页，重新点击"抽好友卡片"继续；次数用完会由 isTodayCountZero 退出循环
      taskLog('未检测到抽卡结果，返回首页重进')
      goBack()
      if (!isOnMagicSpeciesPage()) {
        taskLog('返回后不在神奇物种首页，重新进入')
        if (!openMagicSpecies()) {
          return false
        }
      }
      sleep(2000)
      if (!findAndClickByTextVisible(/^抽好友卡片$/)) {
        LogFloaty.pushErrorLog('重进后未找到"抽好友卡片"')
        return false
      }
      sleep(4000)
      continue
    }

    // 循环继续（处理完结果后已回到好友的卡页面）
    taskLog('=== 继续下一轮抽卡 ===')
    sleep(2000)
  }

  // 交换完成后：刮卡得能量
  doScratchCards()

  taskLog('========== 神奇物种 完成 ==========')
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
