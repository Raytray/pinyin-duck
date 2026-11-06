-- PinyinDuck gloss filter for the Rime ({{HOST}}) {{OS}} input method.
--
-- Rime's dictionary format has no field a candidate can display the definition from:
-- librime's EntryCollector reads text/code/weight and discards the comment column. The
-- build emits lua/pinyinduck_gloss.lua from that comment column, and this filter puts
-- the definition on each candidate by looking it up there.
--
-- The sidecar is optional by design. Without it (or without librime-lua at all) the schema
-- still works: candidates appear, digits still select them, and the comment falls back to
-- the spelling echo — the state before definitions existed.

local ok, result = pcall(require, "pinyinduck_gloss")
local gloss = ok and type(result) == "table" and result or nil
if not ok then
  io.stderr:write("[pinyinduck] gloss sidecar not loaded: " .. tostring(result) .. "\n")
end

-- The lookup table stores codes as the dictionary spells them (ü included). The schema's
-- xlit/ü/v/ rule means a candidate's comment can carry either spelling, so normalise both
-- sides to v before comparing.
local function normalise(code)
  return string.gsub(code or "", "ü", "v")
end

local function resolve_gloss(text, comment, preedit)
  local by_text = gloss[text]
  if not by_text then return nil end
  for _, key in ipairs({ comment, preedit }) do
    if key and by_text[key] then return by_text[key] end
  end
  local ncomment, npreedit = normalise(comment), normalise(preedit)
  for stored, value in pairs(by_text) do
    local ns = normalise(stored)
    if ncomment ~= "" and ncomment == ns then return value end
    if npreedit ~= "" and npreedit == ns then return value end
  end
  return nil
end

-- A module of its own rather than a global in rime.lua, which belongs to the user: Rime
-- loads exactly one rime.lua per user folder, so installing ours would replace whatever
-- Lua components they already have. The schema loads this file by name with
-- `lua_filter@*pinyinduck_gloss_filter` (librime-lua 2023 and later), so rime.lua is
-- never touched.
local function filter(input)
  for cand in input:iter() do
    if gloss then
      local resolved = resolve_gloss(cand.text, cand.comment, cand.preedit)
      if resolved then
        cand:get_genuine().comment = resolved
      end
    end
    yield(cand)
  end
end

return { func = filter }
