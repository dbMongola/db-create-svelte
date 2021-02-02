const os = require('os')
const path = require('path')
const https = require('https')
const execSync = require('child_process').execSync
const chalk = require('chalk')
const commander = require('commander')
const envinfo = require('envinfo')
const fs = require('fs-extra')
const semver = require('semver')
const spawn = require('cross-spawn')
const validateProjectName = require('validate-npm-package-name')
const packageJson = require('./package.json')

let projectName
let template = ''
const Warehouse = 'dbMongola/svelte-template'

function init() {
  const program = new commander.Command(packageJson.name)
    .version(packageJson.version)
    .arguments('<project-directory>')
    .usage(`${chalk.green('<project-directory>')} [options]`)
    .action(name => {
      projectName = name
    })
    .option('-v', '脚手架版本号')
    .option('--verbose', '输出下载日志')
    .option('--info', '环境调试信息')
    .option('--mpa', '多页面开发模板')
    .option('--use-cnpm')
    .allowUnknownOption()
    .on('--help', () => {
      console.log(`    只有 ${chalk.green('<project-directory>')} 是必填的。`)
      console.log()
      console.log(`    选项 ${chalk.cyan('--mpa')} 指定为多页模板`)
      console.log()
      console.log(`    如果你有任何问题，不要犹豫，提出一个问题:`)
      console.log(`      ${chalk.cyan('https://github.com/dbMongola/db-create-svelte/issues/new')}`)
      console.log()
    })
    .parse(process.argv)

  if (program.info) {
    console.log(chalk.bold('\n环境信息:'))
    console.log(`\n  当前版本 ${packageJson.name}: ${packageJson.version}`)
    console.log(`  运行在 ${__dirname}`)
    return envinfo
      .run(
        {
          System: ['OS', 'CPU'],
          Binaries: ['Node', 'npm', 'Yarn'],
          Browsers: ['Chrome', 'Edge', 'Internet Explorer', 'Firefox', 'Safari'],
          npmPackages: ['svelte'],
          npmGlobalPackages: ['db-create-svelte'],
        },
        {
          duplicates: true,
          showNotFound: true,
        }
      )
      .then(console.log)
  }

  if (program.mpa) {
    template = '-mpa'
  }

  if (typeof projectName === 'undefined') {
    console.error("控制台.错误（'请指定项目目录：'）")
    console.log(`  ${chalk.cyan(program.name())} ${chalk.green('<project-directory>')}`)
    console.log()
    console.log('例如:')
    console.log(`  ${chalk.cyan(program.name())} ${chalk.green('my-svelte-app')}`)
    console.log()
    console.log(`执行 ${chalk.cyan(`${program.name()} --help`)} 查看所有选项.`)
    process.exit(1)
  }

  // 我们首先通过API直接检查注册表，如果失败，我们尝试较慢的“npm view[package]version”命令。
  // 对于防火墙阻止直接访问npm的环境中的用户来说，这一点非常重要，并且包是通过专用注册中心专门提供的。
  checkForLatestVersion()
    .catch(() => {
      try {
        // 打印脚手架版本
        return execSync('npm view db-create-svelte version').toString().trim()
      } catch (e) {
        return null
      }
    })
    .then(latest => {
      // 版本比较
      if (latest && semver.lt(packageJson.version, latest)) {
        console.log()
        console.error(chalk.yellow(`当前 \`db-create-svelte\` 版本 ${packageJson.version}，最新版本(${latest})。`))
        console.log()
      }

      createApp(projectName, program.verbose, program.useCnpm)
    })
}

async function createApp(name, verbose, useCnpm) {
  const unsupportedNodeVersion = !semver.satisfies(process.version, '>=10')
  if (unsupportedNodeVersion) {
    console.log(
      chalk.yellow(
        `您正在使用Node${process.version}旧版本的项目将不受支持。\n\n` +
          `请更新到Node10或更高版本以获得更好的、完全支持的体验。\n`
      )
    )
  }

  const root = path.resolve(name)
  const appName = path.basename(root)
  checkAppName(appName)
  fs.ensureDirSync(name)

  if (!isSafeToCreateProjectIn(root, name)) {
    process.exit(1)
  }
  console.log()

  // clone 模板
  await cloneTempalte(appName).catch(err => {
    console.log(err)
  })

  console.log(`在${chalk.green(root)}中创建新的Svelte${template !== '-mpa' ? '单页' : '多页'}应用程序。`)
  console.log()

  const packageJson = {
    name: appName,
    version: '1.0.0',
    private: true,
  }

  let json = fs.readJSONSync(path.join(root, 'package.json'))
  json = { ...json, ...packageJson }
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(json, null, 2) + os.EOL)

  process.chdir(root)
  if (!useCnpm && !checkThatNpmCanReadCwd()) {
    process.exit(1)
  }

  // 检测NPM版本
  const npmInfo = checkNpmVersion()
  if (!npmInfo.hasMinNpm) {
    if (npmInfo.npmVersion) {
      console.log(
        chalk.yellow(
          `你正在使用npm${npmInfo.npmVersion}因此，该项目将使用不受支持的旧版本工具进行引导.\n\n` +
            `请更新到npm 6或更高版本以获得更好的、完全支持的体验.\n`
        )
      )
    }
  }

  run(verbose, useCnpm)
}

function run(verbose, useCnpm) {
  console.log('正在安装依赖包。这可能需要几分钟。')

  install(useCnpm, verbose).then(() => {
    console.log()
    console.log()
    console.log(chalk.bold.green('依赖包安装完成。'))
    console.log()
    console.log(chalk.bold.blue(`    cd ${projectName}`))
    console.log()
    console.log(chalk.bold.blue('    npm start'))
    console.log()
    console.log(chalk.bold.green('来启动你的项目吧！'))
  })
}

function install(useCnpm, verbose) {
  return new Promise((resolve, reject) => {
    let command
    let args

    command = useCnpm ? 'cnpm' : 'npm'
    args = ['install', '--save', '--save-exact', '--loglevel', 'error']

    if (verbose) {
      args.push('--verbose')
    }

    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('close', code => {
      if (code !== 0) {
        reject({
          command: `${command} ${args.join(' ')}`,
        })
        return
      }
      resolve()
    })
  })
}

function cloneTempalte(projectName) {
  return new Promise((resolve, reject) => {
    const command = 'npx '
    const args = ['degit', Warehouse + template, projectName]
    console.log('正在拉取模板....')

    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('close', code => {
      if (code !== 0) {
        reject({
          command: `${command} ${args}`,
        })
        return
      }
      resolve()
    })
  })
}

function checkNpmVersion() {
  let hasMinNpm = false
  let npmVersion = null
  try {
    npmVersion = execSync('npm --version').toString().trim()
    hasMinNpm = semver.gte(npmVersion, '6.0.0')
  } catch (err) {
    // ignore
  }
  return {
    hasMinNpm: hasMinNpm,
    npmVersion: npmVersion,
  }
}

function checkAppName(appName) {
  const validationResult = validateProjectName(appName)
  if (!validationResult.validForNewPackages) {
    console.error(
      chalk.red(
        `无法创建名为的项目${chalk.green(`"${appName}"`)} 
        因为npm命名限制:\n`
      )
    )
    ;[...(validationResult.errors || []), ...(validationResult.warnings || [])].forEach(error => {
      console.error(chalk.red(`  * ${error}`))
    })
    console.error(chalk.red('\n请选择其他项目名称'))
    process.exit(1)
  }

  const dependencies = ['svelte'].sort()
  if (dependencies.includes(appName)) {
    console.error(
      chalk.red(
        `无法创建名为的项目 ${chalk.green(`"${appName}"`)} 因为存在同名的依赖关系.\n` +
          `由于npm的工作方式，以下名称是不允许的:\n\n`
      ) +
        chalk.cyan(dependencies.map(depName => `  ${depName}`).join('\n')) +
        chalk.red('\n\n请选择其他项目名称.')
    )
    process.exit(1)
  }
}

function checkThatNpmCanReadCwd() {
  const cwd = process.cwd()
  let childOutput = null

  try {
    // 注意：故意使用spawn over exec，因为问题不会以其他方式重现。
    // `npm config list`是唯一可靠的复制错误路径的方法。只是process.cwd在节点进程中（）是不够的。
    childOutput = spawn.sync('npm', ['config', 'list']).output.join('')
  } catch (err) {
    // spawning node出错。
    // 不太好，但这意味着我们不能做这个检查。
    // 我们以后可能会失败，但还是继续吧。
    return true
  }

  if (typeof childOutput !== 'string') {
    return true
  }

  const lines = childOutput.split('\n')
  //  `npm config list`输出包括以下行：
  //  “cwd=C:\path\to\current\dir”（未加引号）
  //  我找不到一个更简单的方法来得到它。
  const prefix = '; cwd = '
  const line = lines.find(line => line.startsWith(prefix))

  if (typeof line !== 'string') {
    // 优雅地失败。他们可以把它移走。
    return true
  }

  const npmCWD = line.substring(prefix.length)

  if (npmCWD === cwd) {
    return true
  }

  console.error(
    chalk.red(
      `无法在正确的目录中启动npm进程.\n\n` +
        `当前的目录是: ${chalk.bold(cwd)}\n` +
        `但是，一个新启动的npm进程运行在: ${chalk.bold(npmCWD)}\n\n` +
        `这可能是由错误配置的系统终端外壳引起的.`
    )
  )

  if (process.platform === 'win32') {
    console.error(
      chalk.red(`在Windows上，通常可以通过运行:\n\n`) +
        `  ${chalk.cyan('reg')} delete "HKCU\\Software\\Microsoft\\Command Processor" /v AutoRun /f\n` +
        `  ${chalk.cyan('reg')} delete "HKLM\\Software\\Microsoft\\Command Processor" /v AutoRun /f\n\n` +
        chalk.red(`试着在终端执行上面两个命令\n`) +
        chalk.red(
          `要了解有关此问题的更多信息，请阅读: https://blogs.msdn.microsoft.com/oldnewthing/20071121-00/?p=24433/`
        )
    )
  }
  return false
}

function isSafeToCreateProjectIn(root, name) {
  const validFiles = [
    '.DS_Store',
    '.git',
    '.gitattributes',
    '.gitignore',
    '.gitlab-ci.yml',
    '.hg',
    '.hgcheck',
    '.hgignore',
    '.idea',
    '.npmignore',
    '.travis.yml',
    'docs',
    'LICENSE',
    'README.md',
    'mkdocs.yml',
    'Thumbs.db',
  ]

  const errorLogFilePatterns = ['npm-debug.log', 'yarn-error.log', 'yarn-debug.log']

  const isErrorLog = file => {
    return errorLogFilePatterns.some(pattern => file.startsWith(pattern))
  }

  const conflicts = fs
    .readdirSync(root) // 读取项目目录
    .filter(file => !validFiles.includes(file))
    // IntelliJ IDEA在CRA启动之前创建模块文件
    .filter(file => !/\.iml$/.test(file))
    // 不要将以前安装的日志文件视为冲突
    .filter(file => !isErrorLog(file))

  if (conflicts.length > 0) {
    console.log(`目录${chalk.green(name)}包含可能冲突的文件`)
    console.log()
    for (const file of conflicts) {
      try {
        // 获取文件状态，是文件还是文件夹
        const stats = fs.lstatSync(path.join(root, file))
        if (stats.isDirectory()) {
          console.log(`  ${chalk.blue(`${file}/`)}`)
        } else {
          console.log(`  ${file}`)
        }
      } catch (e) {
        console.log(`  ${file}`)
      }
    }
    console.log()
    console.log('请尝试使用新的目录名，或删除上面列出的文件.')

    return false
  }

  fs.readdirSync(root).forEach(file => {
    if (isErrorLog(file)) {
      fs.removeSync(path.join(root, file))
    }
  })
  return true
}

function checkForLatestVersion() {
  return new Promise((resolve, reject) => {
    https
      .get('https://registry.npmjs.org/-/package/db-create-svelte/dist-tags', res => {
        if (res.statusCode === 200) {
          let body = ''
          res.on('data', data => (body += data))
          res.on('end', () => {
            resolve(JSON.parse(body).latest)
          })
        } else {
          reject()
        }
      })
      .on('error', () => {
        reject()
      })
  })
}

module.exports = init
