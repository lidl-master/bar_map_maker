// Trusted Lua runner (Lua 5.4 via wasmoon). Evaluating it returns run(host) -> JSON string:
// {"mapinfo":…,"lava":…} or {"error":"file:line: message"}. Only this chunk can reach debug/load/io/os;
// map code runs in `env`, which holds just the names set below. Everything map code could later
// tamper with (the shared string library) is captured as a local before map code runs.
export const SANDBOX_LUA = String.raw`
local INSTRUCTION_LIMIT, HOOK_EVERY = 20000000, 1000
local LIMIT_ERROR = "instruction limit exceeded"
local debug, load, pcall, xpcall, error, type, tostring, next, rawlen, rawget, setmetatable, unpack =
  debug, load, pcall, xpcall, error, type, tostring, next, rawlen, rawget, setmetatable, table.unpack
local format, gsub, gmatch, lower, byte, concat, sort, mathtype, huge =
  string.format, string.gsub, string.gmatch, string.lower, string.byte, table.concat, table.sort, math.type, math.huge

local function with(lib, extra)
  local copy = {}
  for k, v in next, lib do copy[k] = v end
  for k, v in next, extra do copy[k] = v end
  return copy
end

local function escape(c) return format("\\u%04x", byte(c)) end

-- JSON for plain data: exact 1..n sequences become arrays, other tables objects with sorted keys,
-- anything else (functions, cycles, inf/nan) null. Uses raw access only, so no map code runs here.
local function encode(v, lowerKeys, open)
  local t = type(v)
  if t == "string" then return '"' .. gsub(v, '[%c"\\]', escape) .. '"' end
  if t == "boolean" then return tostring(v) end
  if t == "number" then
    if mathtype(v) == "integer" then return format("%d", v) end
    if v ~= v or v == huge or v == -huge then return "null" end
    return format("%.17g", v)
  end
  if t ~= "table" or open[v] then return "null" end
  open[v] = true
  local parts, count, n = {}, 0, rawlen(v)
  for _ in next, v do count = count + 1 end
  if n > 0 and n == count then
    for i = 1, n do parts[i] = encode(rawget(v, i), lowerKeys, open) end
    open[v] = nil
    return "[" .. concat(parts, ",") .. "]"
  end
  for k, x in next, v do
    local kt = type(k)
    if kt == "string" or kt == "number" then
      local key = kt == "number" and encode(k) or lowerKeys and lower(k) or k
      parts[#parts + 1] = encode(key) .. ":" .. encode(x, lowerKeys, open)
    end
  end
  open[v] = nil
  sort(parts)
  return "{" .. concat(parts, ",") .. "}"
end

return function(host)
  local env, budget = {}, INSTRUCTION_LIMIT // HOOK_EVERY
  local function guard(...) -- map code must not swallow the instruction limit with pcall
    if budget < 0 then error(LIMIT_ERROR, 0) end
    return ...
  end
  local function include(path, fenv)
    path = tostring(path)
    local src = host.readText(path)
    if not src then error("VFS.Include: file not found: " .. path, 2) end
    local chunk, syntaxError = load(src, "@" .. path, "t", fenv or env)
    if not chunk then error(syntaxError, 0) end
    return chunk()
  end
  local function echo() end
  for _, name in next, { "assert", "error", "ipairs", "next", "pairs", "rawequal", "rawget", "rawlen", "rawset",
      "select", "tonumber", "tostring", "type", "getmetatable", "_VERSION" } do
    env[name] = _G[name]
  end
  env._G, env.print, env.unpack = env, echo, unpack
  env.string = with(string, { gfind = gmatch })
  env.table = with(table, { getn = rawlen })
  env.math = with(math, { pow = function(x, y) return x ^ y end })
  -- shortcut: one environment for all map code; revisit if a map needs real per-function environments.
  env.getfenv = function() return env end
  env.setfenv = function(f) return f end
  env.loadstring = function(s, name) return load(s, name, "t", env) end
  env.pcall = function(...) return guard(pcall(...)) end
  env.xpcall = function(...) return guard(xpcall(...)) end
  -- Finalizers run with hooks off (and at close), so they would escape the instruction limit.
  env.setmetatable = function(t, mt)
    if type(mt) == "table" and rawget(mt, "__gc") ~= nil then error("__gc is not allowed in map Lua", 2) end
    return setmetatable(t, mt)
  end
  env.Spring = { Echo = echo, Log = echo, GetMapOptions = function() return {} end, GetModOptions = function() return {} end }
  env.Game = {}
  env.VFS = {
    Include = include,
    LoadFile = function(path) return host.readText(tostring(path)) end,
    FileExists = function(path) return host.exists(tostring(path)) end,
    DirList = function(dir, pattern, _, recursive)
      return host.dirList(tostring(dir), pattern and tostring(pattern), recursive == true)
    end,
  }

  -- shortcut: counts VM instructions only; a slow C call (huge pattern match) is not interrupted.
  debug.sethook(function()
    budget = budget - 1
    if budget < 0 then error(LIMIT_ERROR, 0) end
  end, "", HOOK_EVERY)
  local ok, mapinfo, lava = pcall(function()
    local mapinfo = include("mapinfo.lua")
    if type(mapinfo) ~= "table" then error("mapinfo.lua did not return a table", 0) end
    return mapinfo, host.exists("mapconfig/lava.lua") and include("mapconfig/lava.lua") or nil
  end)
  debug.sethook()
  if not ok then
    return '{"error":' .. encode(type(mapinfo) == "string" and mapinfo or "map Lua raised a " .. type(mapinfo)) .. "}"
  end
  -- The engine reads mapinfo case-insensitively, so its keys are lowered; lava.lua is read by game Lua as is.
  return '{"mapinfo":' .. encode(mapinfo, true, {}) .. ',"lava":' .. encode(lava, false, {}) .. "}"
end
`;
