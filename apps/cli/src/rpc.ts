/**
 * The RPC endpoints of the CLI. `DEPTHWATCH_RPC_URL` (`--rpc-url`) serves every read: `eth_call`
 * and multicalls, blocks, the chain id. `DEPTHWATCH_LOGS_RPC_URL` (`--logs-rpc-url`, default: the
 * same URL) serves `eth_getLogs` only, so a provider whose plan caps log ranges (Alchemy's free
 * tier: 10 blocks) can keep the calls while log scans go to an endpoint that accepts wide ranges,
 * such as Base's public https://mainnet.base.org. On the capped endpoint alone, short scans still
 * work with `DEPTHWATCH_LOG_CHUNK` set to the provider's limit; 24 h of volume no longer is one
 * since Base's 200 ms blocks (432 000 blocks: 43 200 requests per event source at 10). URLs are
 * never logged: they can carry API keys. The log names the variable, and error text (viem puts the
 * URL in its messages) keeps only each URL's origin (log.ts `errorMessage`, `describeError` below).
 */
import {
  type ChainReader,
  createChainReader,
  isLogRangeLimitError,
  type LogRangeLimitError,
  type RpcRequestEvent,
  redactUrls,
} from '@depthwatch/chain'
import type { Config } from './config.js'
import { errorMessage, type Logger } from './log.js'

/**
 * A live command was started without an RPC endpoint. Not a usage error: the command line was
 * fine, the environment is not, so the CLI exits 1 like any other runtime failure.
 */
export class MissingRpcUrlError extends Error {
  override readonly name = 'MissingRpcUrlError'
}

/** The RPC URL for a live command, or a MissingRpcUrlError that says exactly what to set. */
export function requireRpcUrl(config: Config, command: string): string {
  if (config.rpcUrl !== undefined) return config.rpcUrl
  throw new MissingRpcUrlError(
    `"${command}" reads Base mainnet and needs an RPC endpoint: set DEPTHWATCH_RPC_URL ` +
      '(e.g. https://mainnet.base.org) or pass --rpc-url. Use "depthwatch demo" to run offline.',
  )
}

/** The two ways out when the logs endpoint cannot serve the configured `eth_getLogs` chunks. */
export function logsEndpointHint(error: LogRangeLimitError): string {
  const { maxRange } = error.details
  const limit = maxRange === undefined ? 'a span it accepts' : `the provider's limit, ${maxRange}`
  return (
    'Either set DEPTHWATCH_LOGS_RPC_URL (or --logs-rpc-url) to an endpoint that accepts larger ' +
    'eth_getLogs ranges, for example https://mainnet.base.org, or, for short scans (24 h of ' +
    "volume is 432,000 blocks of Base's 200 ms blocks: 43,200 requests per event source at 10), " +
    `set DEPTHWATCH_LOG_CHUNK (or --log-chunk) to ${limit}.`
  )
}

/**
 * One line for stderr, URLs cut to their origin; a LogRangeLimitError ends with the CLI's fixes
 * instead of the library's.
 */
export function describeError(error: unknown): string {
  if (isLogRangeLimitError(error)) return redactUrls(`${error.summary} ${logsEndpointHint(error)}`)
  return errorMessage(error)
}

export interface CliChainOptions {
  /** The command name for the missing-endpoint message (`mm sample`, `discover`, …). */
  command: string
  /** Live commands read the chain and refuse to start without DEPTHWATCH_RPC_URL. */
  live: boolean
  /** Hears every request (`depthwatch start` counts them per endpoint and method). */
  onRequest?: (event: RpcRequestEvent) => void
  /** Stops the reader (`depthwatch start` on SIGTERM): no request is sent once it aborts. */
  signal?: AbortSignal
}

/**
 * The chain reader of a command. Non-live commands never call it; for them the library's default
 * URL is only a placeholder. Every backoff is logged as a warning: `eth_getLogs` ones with their
 * block range, main-endpoint ones (multicalls, blocks) with the request's name, never its body.
 */
export function createCliChainReader(
  config: Config,
  opts: CliChainOptions,
  log: Logger,
): ChainReader {
  const rpcUrl = opts.live ? requireRpcUrl(config, opts.command) : config.rpcUrl
  if (opts.live)
    log.info('rpc endpoints', {
      logs: config.logsRpcUrl === rpcUrl ? 'DEPTHWATCH_RPC_URL' : 'DEPTHWATCH_LOGS_RPC_URL',
      logChunk: config.logChunkSize,
    })
  return createChainReader({
    rpcUrl,
    logsRpcUrl: config.logsRpcUrl,
    logChunkSize: config.logChunkSize,
    onRequest: opts.onRequest,
    signal: opts.signal,
    logRetry: {
      onRetry: (event) =>
        log.warn('eth_getLogs backoff', {
          reason: event.reason,
          retry: `${event.attempt}/${event.retries}`,
          delayMs: event.delayMs,
          fromBlock: event.fromBlock,
          toBlock: event.toBlock,
        }),
    },
    onCallRetry: (event) =>
      log.warn('rpc backoff', {
        reason: event.reason,
        retry: `${event.attempt}/${event.retries}`,
        delayMs: event.delayMs,
        request: event.what,
      }),
  })
}
