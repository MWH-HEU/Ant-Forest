let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
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

// ============================================================
// 核心逻辑：AI摸鱼
// ============================================================

// 遍历所有控件，正则匹配文本并点击
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

// 遍历可见区域内的控件，用正则 pattern 匹配文本，匹配到第一个符合条件的节点即点击并返回 true；未匹配到返回 false
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

/**
 * 通过模板图片匹配指定 key 的图标并点击
 * 模板未配置或匹配失败时回退到 OCR 识别
 * @param {string} templateKey - config.image_config 中的模板 key（如 ai_fish_icon / rescue_fish）
 * @param {string} ocrText - OCR 兜底识别的文字（如 "AI摸鱼" / "解救鱼"）
 * @returns {boolean} 是否成功找到并点击
 */
function clickByTemplateOrOcr (templateKey, ocrText) {
  // 方案1：模板图片匹配（优先）
  if (config.image_config && config.image_config[templateKey]) {
    try {
      let screen = commonFunction.captureScreen()
      if (screen) {
        let match = OpenCvUtil.findByGrayBase64(screen, config.image_config[templateKey], false)
        if (match) {
          let centerX = Math.round(match.centerX())
          let centerY = Math.round(match.centerY())
          taskLog('模板匹配找到"' + ocrText + '"(' + templateKey + '): 点击: (' + centerX + ', ' + centerY + ')')
          automator.click(centerX, centerY)
          sleep(2000)
          return true
        }
        taskLog('模板匹配未找到"' + ocrText + '"(' + templateKey + ')，回退到OCR')
      } else {
        taskLog('截屏失败，回退到OCR')
      }
    } catch (e) {
      taskLog('模板匹配异常: ' + e + '，回退到OCR')
    }
  } else {
    taskLog('未配置' + templateKey + '模板，使用OCR')
  }

  // 方案2：OCR识别（兜底，直接调用 clickByOcr，带重试机制）
  taskLog('通过OCR识别"' + ocrText + '"')
  return clickByOcr(ocrText, 3000)
}

// 打开进入神奇海洋的函数（形如 openAntForest）
function openOcean () {
  taskLog('进入神奇海洋')

  commonFunction.backHomeIfInVideoPackage()

  // // 先杀掉支付宝进程，强制冷启动进入神奇海洋主页面（避免停留在子页面）
  // killApps()
  // sleep(2000)

  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=2021003115672468',
    packageName: config.package_name
  })

  // 处理"打开"确认弹窗
  let confirm = widgetUtils.widgetGetOne(/^打开$/, 1000)
  if (confirm) {
    automator.clickCenter(confirm)
  }

  commonFunction.readyForAlipayWidgets()

  // 等待进入神奇海洋页面
  sleep(2000)
  if (!isOnOceanPage()) {
    LogFloaty.pushErrorLog('不在神奇海洋页面，退出脚本')
    return false
  }
  taskLog('进入神奇海洋成功')
  return true
}

// 判断是否在神奇海洋界面（全部文本都检测到才算成功，支持通配符；完全匹配用 ^xxx$）
// 匹配文本："蚂蚁森林.*神奇海洋"(非完全) ".*前去参与保护项目"(非完全) "返回"(完全)
function isOnOceanPage () {
  let texts = ['蚂蚁森林.*神奇海洋', '.*前去参与保护项目', '^返回$']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], texts[i], 5000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在神奇海洋界面')
      return false
    }
    taskLog('检测到"' + texts[i] + '"')
  }
  taskLog('全部文本检测到，确认在神奇海洋界面')
  sleep(4000) // 等待界面加载完成
  return true
}

// 进入AI摸鱼（形如 enterFishPage）
// 调用 openOcean 进入神奇海洋 → 判断是否在界面 → 先模板匹配 ai_fish_icon "去摸鱼"，OCR兜底；
// 未匹配到再模板匹配 rescue_fish "解救鱼"，OCR兜底；都没匹配到则失败。
// 注意：这里不判断是否在摸鱼界面，因为进入摸鱼界面后有可能需要出现弹窗，需要特殊处理。
function enterFishPage () {
  taskLog('进入AI摸鱼')

  // 进入神奇海洋
  if (!openOcean()) {
    LogFloaty.pushErrorLog('无法进入神奇海洋')
    return false
  }

  // 先尝试点击"去摸鱼"（模板 ai_fish_icon 优先，OCR兜底）
  if (clickByTemplateOrOcr('ai_fish_icon', '去摸鱼')) {
    taskLog('已点击"去摸鱼"')
    return true
  }

  // 未匹配到"去摸鱼"，再尝试点击"解救鱼"（模板 rescue_fish 优先，OCR兜底）
  if (clickByTemplateOrOcr('rescue_fish', '解救鱼')) {
    taskLog('已点击"解救鱼"')
    return true
  }

  LogFloaty.pushErrorLog('未找到"去摸鱼"或"解救鱼"入口，进入AI摸鱼失败')
  return false
}

// 判断是否在AI摸鱼界面（全部文本都检测到才算成功，支持通配符；完全匹配用 ^xxx$）
// 匹配文本："蚂蚁森林.*AI摸鱼"(非完全) "规则"(完全) "奖励"(完全)
function isOnFishPage () {
  let texts = ['蚂蚁森林.*AI摸鱼', '^规则$', '^奖励$']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], texts[i], 5000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在AI摸鱼界面')
      return false
    }
    taskLog('检测到"' + texts[i] + '"')
  }
  taskLog('全部文本检测到，确认在AI摸鱼界面')
  sleep(4000) // 等待界面加载完成
  return true
}

// 全局变量："奖励"按钮的 y 坐标（只能在摸鱼界面获取，由 main 在进入任务界面前赋值，供 findAndExecuteFishTask / useAllFishTimes 使用）
let rewardY = -1

// 获取"奖励"的 y 坐标：分别通过模板、OCR、控件三种方式获取，任一成功即返回该 y 值（不点击）
// 返回 y 坐标，全部失败返回 -1
function getRewardY () {
  // 方案1：模板匹配 ai_fish_reward_icon "奖励(AI摸鱼)"（首选）
  if (config.image_config && config.image_config.ai_fish_reward_icon) {
    try {
      let screen = commonFunction.captureScreen()
      if (screen) {
        let match = OpenCvUtil.findByGrayBase64(screen, config.image_config.ai_fish_reward_icon, false)
        if (match) {
          let y = Math.round(match.centerY())
          taskLog('模板匹配获取"奖励"y坐标: ' + y)
          return y
        }
        taskLog('模板匹配未找到"奖励"，尝试OCR')
      } else {
        taskLog('截屏失败，尝试OCR')
      }
    } catch (e) {
      taskLog('模板匹配异常: ' + e + '，尝试OCR')
    }
  } else {
    taskLog('未配置ai_fish_reward_icon模板，尝试OCR')
  }

  // 方案2：OCR识别"奖励"
  taskLog('通过OCR获取"奖励"y坐标')
  let ocrResult = widgetInspector.detectByOcr()
  for (let item of ocrResult.results) {
    if (item.label.indexOf('奖励') >= 0) {
      let y = item.bounds.centerY()
      taskLog('OCR获取"奖励"y坐标: ' + y)
      return y
    }
  }
  taskLog('OCR未识别到"奖励"，尝试控件')

  // 方案3：控件查找"奖励"（完全匹配），若匹配到多个只选最上方的一个（centerY 最小）
  let allNodes = widgetInspector.detectAllNodesVisible().nodes
  let targetNode = null
  for (let n of allNodes) {
    if (n.text && /^奖励$/.test(n.text) && n.bounds) {
      if (!targetNode || n.bounds.centerY() < targetNode.bounds.centerY()) {
        targetNode = n
      }
    }
  }
  if (targetNode) {
    let y = targetNode.bounds.centerY()
    taskLog('控件获取"奖励"y坐标（最上方）: ' + y)
    return y
  }

  taskLog('未通过任何方式获取到"奖励"y坐标')
  return -1
}

// 进入任务界面：在摸鱼界面先通过模板匹配 ai_fish_reward_icon "奖励(AI摸鱼)"（首选），失败则OCR识别"奖励"，再失败则控件点击"奖励"（完全匹配）
function enterTaskPage () {
  taskLog('进入任务界面')

  // 方案1：模板匹配 ai_fish_reward_icon "奖励(AI摸鱼)"（首选）
  if (config.image_config && config.image_config.ai_fish_reward_icon) {
    try {
      let screen = commonFunction.captureScreen()
      if (screen) {
        let match = OpenCvUtil.findByGrayBase64(screen, config.image_config.ai_fish_reward_icon, false)
        if (match) {
          let centerX = Math.round(match.centerX())
          let centerY = Math.round(match.centerY())
          taskLog('模板匹配找到"奖励"，点击: (' + centerX + ', ' + centerY + ')')
          automator.click(centerX, centerY)
          sleep(2000)
          return true
        }
        taskLog('模板匹配未找到"奖励"，尝试OCR')
      } else {
        taskLog('截屏失败，尝试OCR')
      }
    } catch (e) {
      taskLog('模板匹配异常: ' + e + '，尝试OCR')
    }
  } else {
    taskLog('未配置ai_fish_reward_icon模板，尝试OCR')
  }

  // 方案2：OCR识别"奖励"（第二）
  taskLog('通过OCR识别"奖励"')
  if (clickByOcr('奖励', 3000)) {
    taskLog('OCR点击"奖励"成功')
    sleep(2000)
    return true
  }
  taskLog('OCR未识别到"奖励"，尝试控件')

  // 方案3：控件点击"奖励"（完全匹配，最后）
  if (findAndClickByTextVisible(/^奖励$/)) {
    taskLog('控件点击"奖励"成功')
    sleep(2000)
    return true
  }

  LogFloaty.pushErrorLog('未找到"奖励"入口，进入任务界面失败')
  return false
}

// 通过OCR识别并点击指定关键词
// 在 timeout 时间内循环截屏识别，命中即点击返回 true
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

// 摸鱼循环处理：每轮独立检查4种分支，任一存在则处理并继续下一轮，4个分支都不存在才退出
// 1. "继续摸鱼"→点击并等待 2. "收下并涂鸦"→"提交并继续摸鱼"/"确认涂鸦"（任一即提交涂鸦）
// 3. "仅解救"（鱼被别人摸走）→点击仅解救后点击继续摸鱼 4. "仅追回"→首选控件点击，OCR兜底
function loopFishProcess () {
  let maxRounds = 20
  for (let round = 0; round < maxRounds; round++) {
    taskLog('摸鱼循环 第 ' + (round + 1) + ' 轮')

    // 分支1：检查"继续摸鱼"（完全匹配 ^继续摸鱼$），有则点击并等待
    if (clickByOcr('^继续摸鱼$', 3000)) {
      taskLog('已点击"继续摸鱼"，等待8s')
      sleep(8000)
      continue
    }

    // 分支2：检查OCR点击"收下并涂鸦"（完全匹配 ^收下并涂鸦$），有则处理"提交并继续摸鱼"/"确认涂鸦"分支
    if (clickByOcr('^收下并涂鸦$', 3000)) {
      // 判断"提交并继续摸鱼"/"确认涂鸦"分支：这两个按钮任何一个都表示提交涂鸦，存在则处理
      let submitNode = null
      let allNodes = widgetInspector.detectAllNodesVisible().nodes
      for (let n of allNodes) {
        if (n.text && /^(提交并继续摸鱼|确认涂鸦)$/.test(n.text) && n.bounds) {
          submitNode = n
          break
        }
      }
      sleep(1000)
      if (submitNode) {
        // 存在则点击一个坐标：x与它一样，y是centerY - 4*高度（向上偏移4倍控件高度）
        let bd = submitNode.bounds
        let sx = Math.round(bd.centerX())
        let sy = Math.round(bd.centerY() - 4 * bd.height())
        taskLog('找到"提交并继续摸鱼"/"确认涂鸦"，点击其上方坐标: (' + sx + ', ' + sy + ')')
        automator.click(sx, sy)
        sleep(1000)

        // 接着点击"提交并继续摸鱼"或"确认涂鸦"（完全匹配，任一即可）
        if (!findAndClickByTextVisible(/^(提交并继续摸鱼|确认涂鸦)$/)) {
          taskLog('未找到"提交并继续摸鱼"或"确认涂鸦"按钮')
        }
        sleep(8000)
      }
      continue
    }

    // 分支3：检查是否弹出"仅解救"（鱼被别人摸走），有则点击"仅解救"后点击"继续摸鱼"（会自动用完所有摸鱼次数）
    if (findAndClickByTextVisible(/^仅解救$/)) {
      taskLog('检测到"仅解救"，点击"仅解救"')
      sleep(2000)
      // 点击"继续摸鱼"，自动使用当前所有摸鱼次数
      if (!clickByOcr('^继续摸鱼$', 3000)) {
        taskLog('点击"仅解救"后未识别到"继续摸鱼"，退出循环')
        break
      }
      taskLog('已点击"继续摸鱼"，等待8s')
      sleep(8000)
      continue
    }

    // 分支4：检查"仅追回"，首选控件查找点击，OCR兜底（两者任一命中即处理）
    let rescued = false
    if (findAndClickByTextVisible(/^仅追回$/)) {
      taskLog('检测到"仅追回"，点击"仅追回"')
      rescued = true
    } else if (clickByOcr('^仅追回$', 3000)) {
      taskLog('OCR点击"仅追回"')
      rescued = true
    }
    if (rescued) {
      sleep(2000)
      continue
    }

    // 4个分支都不存在，退出循环
    taskLog('未检测到"继续摸鱼""收下并涂鸦""仅追回""仅解救"任一分支，退出循环')
    break
  }

  taskLog('摸鱼循环处理完毕')
  return true
}

// 摸鱼任务按钮（完全匹配）
const FISH_BUTTONS = ['去看看', '去完成']

// 排除项关键词（正则匹配：按钮同行包含任一正则则跳过）
const FISH_SKIP_KEYWORDS = ['.*2次摸鱼次数']

// 判断按钮同行是否包含排除项关键词（用正则匹配）
// 返回命中的关键词，未命中返回 null
function findSkipKeywordInSameRow (allNodes, centerY) {
  for (let node of allNodes) {
    let text = node.text
    if (!text) continue
    for (let kw of FISH_SKIP_KEYWORDS) {
      let re = new RegExp(kw)
      if (re.test(text)) {
        let y = node.bounds.centerY()
        if (Math.abs(y - centerY) < 200) {
          return kw
        }
      }
    }
  }
  return null
}

// 判断同行任务类型：匹配 ".*?\d+s.*摸鱼次数"（非贪婪提取完整秒数），提取秒数
// 返回 { type: 'fish', seconds } 或 { type: 'other' }
function classifyFishTask (allNodes, centerY) {
  for (let node of allNodes) {
    let text = node.text
    if (!text) continue
    // 用非贪婪 .*? 保证 \d+ 捕获完整的时间数字（如"看15s视频"应取15而非5）
    let m = text.match(/.*?(\d+)s.*摸鱼次数/)
    if (m && Math.abs(node.bounds.centerY() - centerY) < 100) {
      return { type: 'fish', seconds: parseInt(m[1]) }
    }
  }
  return { type: 'other' }
}

// 领取奖励：完全匹配"立即领取"，只选位于"奖励"上方的按钮，反复点击
// 保持 while true，但新增计数，最多点击 10 次就退出，防止"立即领取"一直存在导致死循环
function claimImmediateReward () {
  let maxClicks = 10
  let clickCount = 0
  while (true) {
    let result = widgetInspector.detectAllNodesVisible()
    let allNodes = result.nodes
    if (!allNodes || allNodes.length === 0) {
      taskLog('未检测到任何控件')
      return false
    }

    // 只选位于"奖励"上方（centerY 小于 rewardY）的一个"立即领取"按钮
    let targetNode = null
    for (let node of allNodes) {
      let text = node.text
      if (!text || text !== '立即领取') continue
      if (!node.bounds) continue
      // 跳过"奖励"下方或同行的"立即领取"（centerY 大于等于 rewardY 的跳过）
      if (node.bounds.centerY() >= rewardY) continue
      targetNode = node
      break
    }
    if (!targetNode) {
      taskLog('未找到"奖励"上方的"立即领取"按钮')
      return false
    }

    let bd = targetNode.bounds
    taskLog('找到"立即领取"（奖励上方），点击: (' + bd.centerX() + ', ' + bd.centerY() + ')')
    automator.click(bd.centerX(), bd.centerY())
    sleep(2000)

    // 计数，达到上限退出
    clickCount++
    if (clickCount >= maxClicks) {
      taskLog('"立即领取"点击已达 ' + maxClicks + ' 次上限，退出')
      return false
    }
  }
}

// 查找并执行摸鱼任务
// 开头先处理摸鱼循环（loopFishProcess，含"继续摸鱼"/"收下并涂鸦"/"仅追回"/"仅解救"分支）和领取奖励（立即领取）；遍历所有节点，匹配 FISH_BUTTONS 按钮；
// 遍历所有"奖励"上方的节点：先做排除项判断（FISH_SKIP_KEYWORDS 正则，如 ".*2次摸鱼次数"）同行则跳过，再做同行判断匹配 ".*?(\d+)s.*摸鱼次数"（非贪婪提取秒数），
// 找到第一个排除项未命中且匹配摸鱼任务的按钮则点击，等待匹配到的时间+2s，然后等待任务完成回到摸鱼界面；被跳过的按钮继续找下一个
function findAndExecuteFishTask () {
  // 开头先处理摸鱼循环（loopFishProcess 会处理"继续摸鱼"/"收下并涂鸦"/"仅追回"/"仅解救"分支）
  loopFishProcess()

  // 领取奖励（立即领取）
  claimImmediateReward()

  let result = widgetInspector.detectAllNodesVisible()
  let allNodes = result.nodes
  if (!allNodes || allNodes.length === 0) {
    taskLog('未检测到任何控件')
    return false
  }

  // 直接使用全局变量 rewardY（由 main 在进入任务界面前获取），用于跳过其下方的按钮
  taskLog('"奖励"y坐标: ' + rewardY + '，将跳过其下方的摸鱼任务按钮')

  // 遍历所有"奖励"上方的节点，匹配 FISH_BUTTONS 按钮，找到第一个可执行的（排除项未命中且匹配摸鱼任务）
  for (let node of allNodes) {
    let text = node.text
    if (!text) continue

    // 判断是否匹配摸鱼任务按钮类型
    let isTarget = false
    for (let btn of FISH_BUTTONS) {
      if (text === btn) {
        isTarget = true
        break
      }
    }
    if (!isTarget) continue

    let bd = node.bounds
    if (!bd) continue
    // 跳过"奖励"下方的按钮（centerY 大于等于奖励 y 坐标的跳过）
    if (bd.centerY() >= rewardY) continue
    let centerY = bd.centerY()

    // 排除项判断：按钮同行包含排除关键词（正则，如 ".*2次摸鱼次数"）则跳过，继续找下一个按钮
    let skipKeyword = findSkipKeywordInSameRow(allNodes, centerY)
    if (skipKeyword) {
      taskLog('跳过"' + skipKeyword + '"行的按钮: "' + text + '"')
      continue
    }

    // 同行判断：匹配 ".*?(\d+)s.*摸鱼次数"（非贪婪提取秒数），判断是否为摸鱼任务
    let cmd = classifyFishTask(allNodes, centerY)
    if (cmd.type !== 'fish') {
      taskLog('按钮"' + text + '"同行未匹配到"摸鱼次数"任务，跳过')
      continue
    }

    taskLog('找到摸鱼任务按钮: "' + text + '" 点击: (' + bd.centerX() + ', ' + bd.centerY() + ')，任务时长 ' + cmd.seconds + 's')
    automator.click(bd.centerX(), bd.centerY())
    sleep(2000)

    // 等待匹配到的时间+2s
    let waitTime = (cmd.seconds + 2) * 1000
    taskLog('等待 ' + cmd.seconds + 's 任务，实际等待 ' + (cmd.seconds + 2) + 's')
    sleep(waitTime)

    // 等待任务完成并回到摸鱼界面（判断界面用摸鱼界面）
    waitForTaskComplete()

    taskLog('摸鱼任务执行完毕')
    return true
  }

  taskLog('未找到可执行的摸鱼任务')
  return false
}

// 使用所有的摸鱼次数：先返回，在神奇海洋界面则通过模板匹配进入摸鱼界面，否则重新打开进入；
// 进入摸鱼界面后处理首次自动摸鱼（含"仅追回"/"仅解救"），再点击固定坐标（x=屏幕中央，y=奖励）后进入摸鱼循环（由 main 循环调用多次）
function useAllFishTimes () {
  taskLog('使用所有的摸鱼次数')

  // 先返回一次
  goBack()

  // 判断是否在神奇海洋界面
  if (isOnOceanPage()) {
    taskLog('在神奇海洋界面，通过模板匹配进入摸鱼界面')
    // 在神奇海洋界面：直接通过模板匹配点击"去摸鱼"进入摸鱼界面（不重新打开）
    if (!clickByTemplateOrOcr('ai_fish_icon', '去摸鱼')) {
      // 模板匹配"去摸鱼"失败，再尝试"解救鱼"
      if (!clickByTemplateOrOcr('rescue_fish', '解救鱼')) {
        LogFloaty.pushErrorLog('模板匹配进入摸鱼界面失败')
        return false
      }
    }
  } else {
    taskLog('不在神奇海洋界面，重新打开进入摸鱼界面')
    // 不在神奇海洋界面：重新打开进入摸鱼界面
    if (!enterFishPage()) {
      LogFloaty.pushErrorLog('无法进入摸鱼界面')
      return false
    }
  }

  // 进入摸鱼界面后，处理首次进入赠送机会且自动摸鱼的情况（含"仅追回"/"仅解救"处理）
  handleFirstEnterAutoFish()

  // 直接使用全局变量 rewardY（由 main 在进入任务界面前获取），用于计算摸鱼按钮的固定点击坐标
  let clickX = Math.round(config.device_width / 2)
  let clickY = Math.round(rewardY)

  // 点击固定坐标（x=屏幕中央，y=奖励）后进入摸鱼循环（由外部 main 循环调用本函数多次）
  taskLog('点击固定坐标(x=' + clickX + ', y=' + clickY + ')')
  automator.click(clickX, clickY)
  sleep(8000)

  // 点击后进入摸鱼循环，处理"继续摸鱼"/"收下并涂鸦"/"仅追回"/"仅解救"4种分支
  loopFishProcess()

  taskLog('摸鱼次数已使用完毕')
  return true
}

// 处理每天第一次进入摸鱼界面赠送两次摸鱼机会且自动摸鱼的情况：
// 先等待8s，然后进入摸鱼循环处理"继续摸鱼"/"收下并涂鸦"/"仅追回"/"仅解救"4种分支
function handleFirstEnterAutoFish () {
  taskLog('处理首次进入自动摸鱼')

  // 先等待8s（等待自动摸鱼开始）
  sleep(8000)

  // 进入摸鱼循环，处理4种分支
  loopFishProcess()

  taskLog('首次自动摸鱼处理完毕')
  return true
}

// 等待任务完成并回到摸鱼界面
function waitForTaskComplete () {
  taskLog('任务完成，退出页面')

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
      taskLog('切入支付宝失败，重新进入摸鱼界面')
      commonFunction.minimize()
      sleep(500)
      // 先回到摸鱼界面，再进入任务界面
      if (!enterFishPage()) return false
      return enterTaskPage()
    }
    sleep(2000)
  }

  // 2. 返回逻辑：先检测后back，循环直到回到摸鱼界面
  let maxBacks = 3
  for (let i = 0; i < maxBacks; i++) {
    // 先检测是否已在摸鱼界面
    if (isOnFishPage()) {
      taskLog('已回到摸鱼界面')
      return true
    }
    // 不在则back
    taskLog('第' + (i + 1) + '次back')
    goBack()
    sleep(2000)
  }

  taskLog('多次back后仍未回到摸鱼界面，重新进入')
  commonFunction.minimize()
  sleep(500)
  // 先回到摸鱼界面，再进入任务界面
  if (!enterFishPage()) return false
  return enterTaskPage()
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
// 主流程
// ============================================================
function main () {
  taskLog('========== AI摸鱼 开始 ==========')

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

  // 进入AI摸鱼界面
  if (!enterFishPage()) {
    LogFloaty.pushErrorLog('无法进入AI摸鱼界面')
    return false
  }

  // 处理每天第一次进入摸鱼界面赠送两次机会且自动摸鱼的情况
  handleFirstEnterAutoFish()

  // 判断是否在AI摸鱼界面
  if (!isOnFishPage()) {
    LogFloaty.pushErrorLog('不在AI摸鱼界面')
    return false
  }

  // 在摸鱼界面获取"奖励"y坐标（只能在摸鱼界面获取，进入任务界面后无法获取），赋值给全局变量
  rewardY = getRewardY()
  if (rewardY < 0) {
    LogFloaty.pushErrorLog('获取"奖励"y坐标失败，退出脚本')
    return false
  }

  // 进入任务界面
  if (!enterTaskPage()) {
    LogFloaty.pushErrorLog('无法进入任务界面')
    return false
  }

  // 循环执行摸鱼任务，直到没有更多任务
  let maxRounds = 10
  for (let round = 0; round < maxRounds; round++) {
    taskLog('=== AI摸鱼 第 ' + (round + 1) + ' 轮 ===')

    if (findAndExecuteFishTask()) {
      taskLog('摸鱼任务执行完毕，继续下一轮')
      continue
    }
    taskLog('没有更多摸鱼任务可执行')
    break
  }

  // 使用所有的摸鱼次数（循环调用3次）
  for (let i = 0; i < 3; i++) {
    taskLog('=== 使用所有摸鱼次数 第 ' + (i + 1) + ' 次 ===')
    useAllFishTimes()
  }

  taskLog('========== AI摸鱼 完成 ==========')
  taskLog('任务完成')
  exitScript()
  return true
}

// 执行入口
main()
