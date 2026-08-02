/*
 * 刷新图片配置工具
 * 清除 storage 中的旧值，然后根据 config_data/<key>.data 文件重新写入
 * 即：用 data 文件的最新内容覆盖 storage，使配置恢复到文件状态
 *
 * 处理的 storage（2处）：
 * 1. ant_forest_config_fork_version_image（灰度取色.js 同步写入，可视化页面读取）
 * 2. ant_forest_config_fork_version_image（配置存储 CONFIG_STORAGE_NAME + '_image'，用户修改值）
 *
 * 注意：config_data/<key>.data 文件本身不会被删除，只作为数据源
 */
"ui";

let { config } = require('../config.js')(runtime, global)

// 与 config.js 保持一致
let CONFIG_STORAGE_NAME = 'ant_forest_config_fork_version'
let IMG_STORAGE_NAME = 'ant_forest_config_fork_version_image'

// 定位项目根目录
let workPath = files.cwd()
if (!files.exists(workPath + '/main.js')) {
  let paths = workPath.split('/')
  do {
    paths = paths.slice(0, paths.length - 1)
    workPath = paths.reduce((a, b) => a += '/' + b)
  } while (!files.exists(workPath + '/main.js') && paths.length > 0)
}

// 读取 prepareImageConfig 中列出的所有 key
// 优先从 config.js 源码解析，保证与配置始终同步
let imageFields = []
let configJsPath = workPath + '/config.js'
if (files.exists(configJsPath)) {
  let src = files.read(configJsPath)
  let m = src.match(/prepareImageConfig\(\[([\s\S]*?)\]\)/)
  if (m) {
    let re = /'([^']+)'/g
    let match
    while ((match = re.exec(m[1])) !== null) {
      imageFields.push(match[1])
    }
  }
}

// 若解析失败，则手动维护一份（与 config.js 的 prepareImageConfig 保持一致）
if (!imageFields || imageFields.length <= 0) {
  imageFields = [
    'reward_for_plant', 'backpack_icon', 'sign_reward_icon', 'water_icon',
    'stroll_icon', 'watering_cooperation', 'magic_species_icon', 'use_item', 'one_key_collect',
    'main_account_avatar', 'rebirth_5g',
    'paradise_icon', 'get_energy_icon', 'ocean_reward_icon', 'ai_fish_icon', 'ai_fish_reward_icon'
  ]
}

let configDataPath = workPath + '/config_data/'

let imgStorage = storages.create(IMG_STORAGE_NAME)
let configStorage = storages.create(CONFIG_STORAGE_NAME + '_image')

let updated = []       // 有 data 文件、已用文件内容覆盖 storage 的 key
let clearedOnly = []   // 无 data 文件、仅清除 storage 的 key
let missing = []       // data 文件不存在 且 storage 也无值（无需处理）

imageFields.forEach(key => {
  let dataPath = configDataPath + key + '.data'

  if (files.exists(dataPath)) {
    // 有 data 文件：用文件内容覆盖 storage
    let b64 = files.read(dataPath)
    // 清除旧值后写入新值（等价于覆盖）
    if (imgStorage.contains(key)) imgStorage.remove(key)
    imgStorage.put(key, b64)
    if (configStorage.contains(key)) configStorage.remove(key)
    configStorage.put(key, b64)
    updated.push(key)
  } else {
    // 无 data 文件：清除 storage 中的残留旧值
    let hasImg = imgStorage.contains(key)
    let hasCfg = configStorage.contains(key)
    if (hasImg) imgStorage.remove(key)
    if (hasCfg) configStorage.remove(key)
    if (hasImg || hasCfg) {
      clearedOnly.push(key)
    } else {
      missing.push(key)
    }
  }
})

let msg = '刷新完成，共处理 ' + imageFields.length + ' 个配置项：\n\n'
msg += '【已用 data 文件更新】' + (updated.length ? updated.join(', ') : '无') + '\n'
msg += '【仅清除 storage(无data)】' + (clearedOnly.length ? clearedOnly.join(', ') : '无') + '\n'
msg += '【无 data 且 storage 为空】' + (missing.length ? missing.join(', ') : '无') + '\n\n'
msg += '请重启脚本使配置重新初始化生效。'

toastLog(msg)
dialogs.alert('刷新图片配置', msg)
