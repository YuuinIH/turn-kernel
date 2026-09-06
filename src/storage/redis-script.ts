// A single hash/key keeps snapshot and receipts atomic even with Redis Cluster.
export const SESSION_SCRIPT = `
local key = KEYS[1]
local action = ARGV[1]
local nowParts = redis.call('TIME')
local now = tonumber(nowParts[1]) * 1000 + math.floor(tonumber(nowParts[2]) / 1000)
if action == 'create' then
  if redis.call('EXISTS', key) == 1 then return redis.error_reply('Session exists') end
  redis.call('HSET', key, 'snapshot', ARGV[2], 'revision', ARGV[3], 'ruleset', ARGV[4], 'fence', '0', 'owner', '', 'expires', '0')
  return 'created'
end
if redis.call('EXISTS', key) == 0 then return redis.error_reply('Session missing') end
if action == 'load' then
  return {redis.call('HGET', key, 'snapshot'), redis.call('HGET', key, 'fence'), redis.call('HGET', key, 'owner'), redis.call('HGET', key, 'expires')}
end
if action == 'receipt' then return redis.call('HGET', key, 'receipt:' .. ARGV[2]) end
if action == 'claim' then
  local owner = redis.call('HGET', key, 'owner')
  local expires = tonumber(redis.call('HGET', key, 'expires'))
  if expires > now and owner ~= ARGV[2] then return redis.error_reply('Session already owned') end
  local fence = tonumber(redis.call('HGET', key, 'fence'))
  if expires <= now or owner ~= ARGV[2] then
    if fence >= 9007199254740991 then return redis.error_reply('Fence exhausted') end
    fence = fence + 1
  end
  redis.call('HSET', key, 'owner', ARGV[2], 'fence', string.format('%.0f', fence), 'expires', string.format('%.0f', now + tonumber(ARGV[3])))
  return string.format('%.0f', fence)
end
if action == 'commit' then
  local previous = redis.call('HGET', key, 'receipt:' .. ARGV[5])
  if previous then
    if redis.call('HGET', key, 'fingerprint:' .. ARGV[5]) == ARGV[6] then return 'duplicate' end
    return 'request-conflict'
  end
  if redis.call('HGET', key, 'owner') ~= ARGV[2] or redis.call('HGET', key, 'fence') ~= ARGV[3] or tonumber(redis.call('HGET', key, 'expires')) <= now then return 'not-owner' end
  if redis.call('HGET', key, 'revision') ~= ARGV[4] or redis.call('HGET', key, 'ruleset') ~= ARGV[9] then return 'stale' end
  redis.call('HSET', key, 'snapshot', ARGV[7], 'revision', ARGV[10], 'receipt:' .. ARGV[5], ARGV[8], 'fingerprint:' .. ARGV[5], ARGV[6])
  return 'committed'
end
return redis.error_reply('Unknown operation')
`;
