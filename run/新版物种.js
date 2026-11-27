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
let SwitchToApp = require('../lib/SwitchToApp.js')(runtime, global)

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
  let confirm = widgetUtils.widgetGetOne(/^打开$/, 3000)
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
// 传入 pattern 时限时重试，直到识别到匹配文本（或超时）
function ocrScanAll (pattern, timeout) {
  if (!localOcrUtil.enabled) {
    taskLog('OCR未启用，无法识别')
    return []
  }
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

// OCR 识别文本并点击其中心（可选点击/空按钮兜底用）
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

// 点击屏幕宽度20%、高度65%处（仅用于送好友卡片时的兜底选择）
function clickExchangeCardByPosition () {
  let x = parseInt(config.device_width * 0.2)
  let y = parseInt(config.device_height * 0.65)
  taskLog('送好友卡片兜底：点击屏幕(' + x + ', ' + y + ')')
  automator.click(x, y)
  sleep(4000)
  return true
}

// 全屏识别纯数字控件，点击最大的数字（必须大于1）
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

  if (maxNode && maxNum > 1) {
    taskLog('点击最大数字 ' + maxNum + '，位置：(' + maxNode.bounds.centerX() + ', ' + maxNode.bounds.centerY() + ')')
    automator.click(maxNode.bounds.centerX(), maxNode.bounds.centerY())
    sleep(4000)
    return true
  }

  taskLog('未找到大于1的数字卡片')
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

  // 选择交换卡片：必须存在大于1的卡片，否则跳过本次交换
  if (!clickExchangeCardByMaxNumber()) {
    taskLog('无大于1的卡，跳过本次交换')
    goBack()
    return true
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
    taskLog('未找到"点击合成勋章"，说明已合成，正常返回')
    return true
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

// 判断是否已集齐卡片：在"抽好友卡片"的右侧及下方匹配"数字/数字"，两数相等则已集齐；已集齐后合成勋章
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
        return true
      }
    }
  }

  taskLog('未检测到已集齐（两数相等的"数字/数字"）')
  return false
}

// 刮卡得能量：抽卡流程后重新进入首页，循环刮卡
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

// ============ 任务流程 ============

const TASK_BUTTONS = ['去完成', '去逛逛', '去送卡']
const TASK_SPECIALS = ['送好友卡片', '帮好友抽卡']
const TASK_SKIP_KEYWORDS = [] // 无排除项
const ROW_TOLERANCE = 100

// 判断是否在任务页面：需匹配"任务奖励"和"我的道具"，且存在"去完成/去逛逛/去送卡/已完成"任一
function isOnTaskPage () {
  if (!widgetUtils.widgetWaiting('^任务奖励$', '任务奖励', 4000)) {
    taskLog('未检测到"任务奖励"，不在任务页面')
    return false
  }
  if (!widgetUtils.widgetWaiting('^我的道具$', '我的道具', 4000)) {
    taskLog('未检测到"我的道具"，不在任务页面')
    return false
  }
  let result = widgetInspector.detectAllNodesVisible()
  for (let n of result.nodes) {
    if (n.text && /^(去完成|去逛逛|去送卡|已完成)$/.test(n.text)) {
      taskLog('检测到"' + n.text + '"，确认在任务页面')
      return true
    }
  }
  taskLog('未检测到"去完成/去逛逛/去送卡/已完成"，不在任务页面')
  return false
}

// 进入任务页面：重新进入神奇物种后点击"领抽卡机会"
function openTaskPage () {
  taskLog('进入任务页面')
  if (!openMagicSpecies()) {
    LogFloaty.pushErrorLog('进入神奇物种失败')
    return false
  }
  if (!findAndClickByTextVisible(/^领抽卡机会$/)) {
    LogFloaty.pushErrorLog('未找到"领抽卡机会"')
    return false
  }
  sleep(4000)
  if (!isOnTaskPage()) {
    LogFloaty.pushErrorLog('未进入任务页面')
    return false
  }
  return true
}

// 领取当前页面所有奖励：循环点击"立即领取"直到没有
function claimAllRewards () {
  let count = 0
  while (count < 20 && findAndClickByTextVisible(/^立即领取$/)) {
    count++
    taskLog('领取奖励，第' + count + '次')
    sleep(2000)
  }
  if (count > 0) taskLog('共领取奖励 ' + count + ' 次')
}

// 在指定行（±100px）查找关键词
function findKeywordInSameRow (allNodes, centerY, keywords, matchMode) {
  matchMode = matchMode || 'indexOf'
  for (let node of allNodes) {
    let text = node.text
    if (!text || !node.bounds) continue
    for (let kw of keywords) {
      let matched = (matchMode === 'exact') ? (text === kw) : (text.indexOf(kw) >= 0)
      if (matched && Math.abs(node.bounds.centerY() - centerY) <= ROW_TOLERANCE) {
        return kw
      }
    }
  }
  return null
}

// 获取同行任务耗时秒数，无则返回 0
function getTaskSecondsInSameRow (allNodes, centerY) {
  for (let node of allNodes) {
    let text = node.text
    if (!text || !node.bounds) continue
    if (Math.abs(node.bounds.centerY() - centerY) > ROW_TOLERANCE) continue
    let m = text.match(/(\d+)s/)
    if (m) {
      return parseInt(m[1], 10)
    }
  }
  return 0
}

// 任务页下滑（沿用 enterVitalityShopByScrollUp 的手势，距离20%~30%，起点取屏幕中段）
function scrollDownForTask () {
  let h = config.device_height
  let dist = (0.20 + Math.random() * 0.10) * h
  let startY = Math.round(h * (0.40 + Math.random() * 0.20))
  let endY = Math.round(startY + dist)
  automator.gestureUp(startY, endY, 100 + Math.round(Math.random() * 300))
  sleep(2000)
}

// 特殊任务：送好友卡片
function doGiftCardTask () {
  taskLog('=== 送好友卡片 ===')
  sleep(4000)

  // 判断是否在"我的图鉴"页面：三个文本都要匹配
  if (!widgetUtils.widgetWaiting('^全部图鉴$', '全部图鉴', 4000) ||
      !widgetUtils.widgetWaiting('^发现物种$', '发现物种', 4000) ||
      !widgetUtils.widgetWaiting('^我的勋章$', '我的勋章', 4000)) {
    LogFloaty.pushErrorLog('未进入"我的图鉴"页面')
    return false
  }
  taskLog('已进入我的图鉴页面')

  // 选择卡片：优先点击大于1的最大数字，最多下滑10次
  let clicked = false
  for (let i = 0; i < 10; i++) {
    if (clickExchangeCardByMaxNumber()) {
      clicked = true
      break
    }
    taskLog('未找到大于1的数字，下滑第' + (i + 1) + '次')
    scrollDownForTask()
  }
  if (!clicked) {
    taskLog('下滑10次仍未找到大于1的数字，点击固定点')
    clickExchangeCardByPosition()
  }

  // 判断卡片页面：赠送、保存都要匹配
  if (!widgetUtils.widgetWaiting('^赠送$', '赠送', 4000) ||
      !widgetUtils.widgetWaiting('^保存$', '保存', 4000)) {
    LogFloaty.pushErrorLog('未进入卡片页面（赠送/保存）')
    return false
  }

  if (!findAndClickByTextVisible(/^赠送$/)) {
    LogFloaty.pushErrorLog('未找到"赠送"')
    return false
  }
  sleep(2000)
  taskLog('送好友卡片完成')
  return true
}

// 特殊任务：帮好友抽卡（执行一次抽卡，无论是否交换）
function doHelpFriendDrawTask () {
  taskLog('=== 帮好友抽卡 ===')
  sleep(4000)
  if (!isOnFriendCardPage()) {
    LogFloaty.pushErrorLog('未进入好友的卡页面')
    return false
  }

  if (!findAndClickByTextVisible(/^点击抽卡$/)) {
    LogFloaty.pushErrorLog('未找到"点击抽卡"')
    return false
  }
  sleep(6000)

  let cardResult = getCardResultType()
  if (cardResult === 'notOwned') {
    if (!doExchangeFlow()) {
      taskLog('交换流程失败，帮抽任务视为完成')
    }
  } else if (cardResult === 'owned') {
    if (!doGiveUpFlow()) {
      taskLog('放弃流程失败，帮抽任务视为完成')
    }
  } else {
    taskLog('未检测到抽卡结果，帮抽任务结束')
  }
  taskLog('帮好友抽卡完成')
  return true
}

// 任务完成后返回任务页面（最多 back 5 次）
function waitForTaskComplete () {
  taskLog('任务完成，返回任务页面')
  sleep(2000)

  let pkg = config.package_name || 'com.eg.android.AlipayGphone'
  if (currentPackage() !== pkg) {
    taskLog('当前不在支付宝，切入支付宝')
    let switched = SwitchToApp.switchToApp({
      pkg: pkg,
      cardText: '支付宝',
      onLog: taskLog
    })
    if (!switched) {
      taskLog('切入支付宝失败，重新进入任务页面')
      commonFunction.minimize()
      sleep(1000)
      return openTaskPage()
    }
    sleep(4000)
  }

  for (let i = 0; i < 5; i++) {
    if (isOnTaskPage()) {
      taskLog('已回到任务页面')
      return true
    }
    taskLog('第' + (i + 1) + '次back')
    goBack()
    sleep(2000)
  }

  taskLog('back 5 次仍未回到任务页面，重新进入')
  commonFunction.minimize()
  sleep(1000)
  return openTaskPage()
}

// 执行一个任务，成功执行返回 true
function executeOneTask () {
  let allNodes = widgetInspector.detectAllNodesVisible().nodes
  for (let node of allNodes) {
    let text = node.text
    if (!text || !node.bounds) continue
    if (TASK_BUTTONS.indexOf(text) < 0) continue

    let centerY = node.bounds.centerY()

    // 排除项（当前无）
    if (findKeywordInSameRow(allNodes, centerY, TASK_SKIP_KEYWORDS)) {
      continue
    }

    // 特殊任务
    let special = findKeywordInSameRow(allNodes, centerY, TASK_SPECIALS)
    if (special) {
      taskLog('发现特殊任务: ' + special)
      automator.click(node.bounds.centerX(), node.bounds.centerY())
      sleep(2000)
      let ok = false
      if (special === '送好友卡片') {
        ok = doGiftCardTask()
      } else if (special === '帮好友抽卡') {
        ok = doHelpFriendDrawTask()
      }
      if (!ok) {
        taskLog('特殊任务执行失败: ' + special)
      }
      waitForTaskComplete()
      return true
    }

    // 普通任务：只执行匹配到 \d+s 的任务
    let sec = getTaskSecondsInSameRow(allNodes, centerY)
    if (sec <= 0) {
      taskLog('同行未识别到耗时，跳过按钮: ' + text)
      continue
    }

    taskLog('执行普通任务: ' + text + '，等待 ' + (sec + 5) + 's')
    automator.click(node.bounds.centerX(), node.bounds.centerY())
    sleep((sec + 5) * 1000)
    waitForTaskComplete()
    return true
  }
  taskLog('未找到可执行的任务')
  return false
}

// 使用道具：点击"我的道具"，循环使用直到没有"使用"
function useAllItems () {
  taskLog('=== 使用道具 ===')

  if (!findAndClickByTextVisible(/^我的道具$/)) {
    taskLog('未找到"我的道具"，跳过道具使用')
    return false
  }
  sleep(4000)

  if (!hasTextVisible(/^使用$/)) {
    taskLog('没有可使用的道具，结束')
    return true
  }

  let maxRounds = 20
  while (maxRounds-- > 0) {
    if (!findAndClickByTextVisible(/^使用$/)) {
      taskLog('没有"使用"按钮，道具使用结束')
      break
    }
    sleep(2000)

    // 下次不再提醒
    if (findAndClickByTextVisible(/^下次不再提醒$/)) {
      sleep(1000)
    }

    // 点击与"再想想"同行且 x 小于屏幕宽度75%的"使用"
    let nodes = widgetInspector.detectAllNodesVisible().nodes
    let thinkAgainY = null
    for (let n of nodes) {
      if (n.text && /^再想想$/.test(n.text) && n.bounds) {
        thinkAgainY = n.bounds.centerY()
        break
      }
    }
    if (thinkAgainY !== null) {
      for (let n of nodes) {
        if (n.text && /^使用$/.test(n.text) && n.bounds &&
            n.bounds.centerX() < config.device_width * 0.75 &&
            Math.abs(n.bounds.centerY() - thinkAgainY) <= ROW_TOLERANCE) {
          taskLog('点击确认弹窗中的"使用"')
          automator.click(n.bounds.centerX(), n.bounds.centerY())
          sleep(4000)
          break
        }
      }
    }

    // OCR 识别"收下"（可选）
    clickOcrText(/^收下$/, 2000)
  }
  taskLog('=== 道具使用结束 ===')
  return true
}

// 任务流程：每轮先领奖，再执行一个任务，直到没有任务；最后使用道具
function doTaskPage () {
  taskLog('=== 任务流程开始 ===')

  if (!openTaskPage()) {
    LogFloaty.pushErrorLog('进入任务页面失败')
    return false
  }

  let maxRounds = 30 // 防御死循环
  while (maxRounds-- > 0) {
    // 每轮开头先领取所有奖励
    claimAllRewards()

    if (!executeOneTask()) {
      taskLog('没有可执行的任务，任务流程结束')
      break
    }
  }

  // 所有任务结束后使用道具
  useAllItems()

  taskLog('=== 任务流程结束 ===')
  return true
}

// ============ 抽卡流程 ============

// 抽卡：进入好友的卡页面，循环抽卡直到今日次数用完
function doDrawCards () {
  taskLog('=== 抽卡流程开始 ===')

  // 每次执行前重新进入神奇物种
  if (!openMagicSpecies()) {
    LogFloaty.pushErrorLog('无法进入神奇物种')
    return false
  }

  if (!findAndClickByTextVisible(/^抽好友卡片$/)) {
    LogFloaty.pushErrorLog('未找到"抽好友卡片"')
    return false
  }
  sleep(4000)

  while (true) {
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

    if (isTodayCountZero()) {
      taskLog('今日次数已用完，退出循环')
      break
    }

    if (!findAndClickByTextVisible(/^点击抽卡$/)) {
      LogFloaty.pushErrorLog('未找到"点击抽卡"')
      return false
    }
    sleep(6000)

    let cardResult = getCardResultType()
    if (cardResult === 'notOwned') {
      if (!doExchangeFlow()) {
        LogFloaty.pushErrorLog('交换流程失败')
        return false
      }
    } else if (cardResult === 'owned') {
      if (!doGiveUpFlow()) {
        LogFloaty.pushErrorLog('放弃流程失败')
        return false
      }
    } else {
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

    taskLog('=== 继续下一轮抽卡 ===')
    sleep(2000)
  }

  taskLog('=== 抽卡流程结束 ===')
  return true
}

// 主流程
function main () {
  taskLog('========== 神奇物种 开始 ==========')

  // 进入神奇物种，判断是否已集齐（集齐则合成勋章）
  if (!openMagicSpecies()) {
    LogFloaty.pushErrorLog('无法进入神奇物种')
    return false
  }
  let collected = checkCardCollected()
  if (collected) {
    taskLog('已集齐卡片，跳过抽卡')
  }

  // 任务流程（内部会重新进入神奇物种）
  doTaskPage()

  // 抽卡流程（未集齐才执行，内部会重新进入）
  if (!collected) {
    doDrawCards()
  }

  // 刮卡流程（必定执行，内部会重新进入）
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
