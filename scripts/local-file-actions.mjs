#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const listenHost = process.env.LOCAL_FILE_ACTIONS_HOST || '0.0.0.0'
const listenPort = Number(process.env.LOCAL_FILE_ACTIONS_PORT || 9333)
const airdropSource = path.join(rootDir, 'scripts', 'airdrop-share.swift')
const airdropBinary = path.join(rootDir, 'config', 'airdrop-share')
const MAX_FILES = 40
let airdropBuild

function ensureAirdropBinary() {
  if (!airdropBuild) {
    airdropBuild = new Promise((resolve, reject) => {
      const sourceTime = statSync(airdropSource).mtimeMs
      let binaryTime = 0
      try { binaryTime = statSync(airdropBinary).mtimeMs } catch { binaryTime = 0 }
      if (binaryTime >= sourceTime) return resolve(airdropBinary)
      mkdirSync(path.dirname(airdropBinary), { recursive: true })
      execFile('swiftc', ['-O', '-o', airdropBinary, airdropSource], { timeout: 120_000 }, (error, _stdout, stderr) => {
        if (error) {
          airdropBuild = undefined
          reject(new Error(String(stderr || error.message).trim() || '无法编译 AirDrop 助手。请安装 Xcode 命令行工具。'))
        } else resolve(airdropBinary)
      })
    }).catch(error => { airdropBuild = undefined; throw error })
  }
  return airdropBuild
}

export function resolveAllowed(rootName, relative, directories) {
  if (rootName !== 'downloads' && rootName !== 'imports') throw new Error('目录无效')
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('路径无效')
  if (relative.split(/[\\/]/).includes('..')) throw new Error('路径无效')
  const base = realpathSync(directories[rootName])
  const target = realpathSync(path.resolve(base, relative))
  const remainder = path.relative(base, target)
  if (!remainder || remainder.startsWith('..') || path.isAbsolute(remainder)) throw new Error('路径越界')
  return target
}

function canReveal() {
  if (process.platform === 'darwin' || process.platform === 'win32') return true
  return process.platform === 'linux' && Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
}

function capabilities() {
  return { reveal: canReveal(), airdrop: process.platform === 'darwin' && existsSync(airdropSource) }
}

function send(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' })
  response.end(body)
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', chunk => {
      size += chunk.length
      if (size > 1024 * 1024) reject(Object.assign(new Error('请求内容过大'), { statusCode: 413 }))
      else chunks.push(chunk)
    })
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch { reject(Object.assign(new Error('请求格式无效'), { statusCode: 400 })) }
    })
    request.on('error', reject)
  })
}

function exec(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 15_000 }, (error, _stdout, stderr) => error ? reject(new Error(String(stderr || error.message).trim())) : resolve())
  })
}

async function reveal(paths) {
  if (process.platform === 'darwin') return exec('open', ['-R', ...paths])
  if (process.platform === 'win32') {
    for (const file of paths) await exec('explorer', [`/select,${file}`])
    return
  }
  for (const directory of new Set(paths.map(file => path.dirname(file)))) await exec('xdg-open', [directory])
}

async function airdrop(paths) {
  if (process.platform !== 'darwin') throw Object.assign(new Error('AirDrop 仅在 Mac 上可用'), { statusCode: 409 })
  const binary = await ensureAirdropBinary()
  return new Promise((resolve, reject) => {
    const child = spawn(binary, paths, { detached: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let error = ''
    let settled = false
    const finish = failure => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (failure) reject(failure)
      else resolve()
    }
    const timer = setTimeout(() => { child.unref(); finish() }, 1200)
    child.stderr?.on('data', chunk => { if (error.length < 2_000) error += String(chunk) })
    child.once('error', failure => finish(failure))
    child.once('exit', code => finish(code && code !== 0 ? new Error(error.trim() || `AirDrop 助手退出码 ${code}`) : undefined))
  })
}

export function createServer(token, directories) {
  const authorized = request => request.headers.authorization === `Bearer ${token}`
  return http.createServer(async (request, response) => {
    try {
      if (!authorized(request)) return send(response, 401, { error: '未授权' })
      const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
      if (request.method === 'GET' && url.pathname === '/capabilities') return send(response, 200, capabilities())
      if (request.method === 'POST' && url.pathname === '/actions') {
        const body = await readBody(request)
        const files = Array.isArray(body.files) ? body.files : []
        if (!files.length) return send(response, 400, { error: '请选择视频' })
        if (files.length > MAX_FILES) return send(response, 400, { error: `一次最多操作 ${MAX_FILES} 个视频` })
        const paths = files.map(file => resolveAllowed(file?.root, file?.relative, directories))
        if (body.action === 'reveal') {
          if (!canReveal()) return send(response, 409, { error: '当前部署不能打开文件所在目录' })
          await reveal(paths)
          return send(response, 200, { count: paths.length })
        }
        if (body.action === 'airdrop') {
          if (!capabilities().airdrop) return send(response, 409, { error: '当前电脑不能使用 AirDrop' })
          await airdrop(paths)
          return send(response, 202, { count: paths.length })
        }
        return send(response, 400, { error: '操作无效' })
      }
      return send(response, 404, { error: '接口不存在' })
    } catch (error) {
      send(response, error.statusCode || 500, { error: error instanceof Error ? error.message : String(error) })
    }
  })
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (invoked) {
  const token = readFileSync(process.env.LOCAL_FILE_ACTIONS_TOKEN_FILE, 'utf8').trim()
  if (!token) throw new Error('本地文件助手缺少令牌')
  const directories = {
    downloads: path.resolve(process.env.LOCAL_FILE_ACTIONS_DOWNLOADS || path.join(rootDir, 'downloads')),
    imports: path.resolve(process.env.LOCAL_FILE_ACTIONS_IMPORTS || path.join(rootDir, 'imports')),
  }
  createServer(token, directories).listen(listenPort, listenHost, () => process.stdout.write(`Local file actions: http://${listenHost}:${listenPort}\n`))
}
