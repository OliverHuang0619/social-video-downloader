import type { Server } from 'node:http'

export function resolveAllowed(rootName: string, relative: string, directories: { downloads: string; imports: string }): string
export function createServer(token: string, directories: { downloads: string; imports: string }): Server
