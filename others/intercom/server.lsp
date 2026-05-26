<?lsp

-- Global rooms table, shared across connections
rooms = rooms or {}

local function broadcast(roomName, msg, excludeId)
   for id, client in pairs(rooms[roomName] or {}) do
      if id ~= excludeId and client.sock then
         client.sock:write(msg, true)
      end
   end
end

if not request:header("Sec-WebSocket-Key") then
   response:senderror(400, "Bad Request")
   return
end

local sock = ba.socket.req2sock(request)
if not sock then
   return
end

local clientId
local roomName
local clientName

local function onData(s)
   while true do
      local data = s:read()
      if not data then
         -- Connection closed
         if roomName and clientId and rooms[roomName] then
            rooms[roomName][clientId] = nil
            if not next(rooms[roomName]) then
               rooms[roomName] = nil
            else
               broadcast(roomName, ba.json.encode({ type = 'peer-left', id = clientId }), clientId)
            end
         end
         break
      end
      local ok, msg = pcall(ba.json.decode, data)
      if not ok then
         trace("Invalid JSON:", msg)
         goto continue
      end
      local tp = msg.type
      if tp == 'join' then
         roomName = msg.room
         clientId = msg.id
         clientName = msg.name
         rooms[roomName] = rooms[roomName] or {}
         rooms[roomName][clientId] = { sock = s, name = clientName }
         -- Send joined with current peers
         local peers = {}
         for id, cl in pairs(rooms[roomName]) do
            if id ~= clientId then
               table.insert(peers, { id = id, name = cl.name })
            end
         end
         s:write(ba.json.encode({ type = 'joined', peers = peers }), true)
         -- Broadcast new-peer to others
         broadcast(roomName, ba.json.encode({ type = 'new-peer', id = clientId, name = clientName }), clientId)
      elseif tp == 'offer' or tp == 'answer' or tp == 'candidate' then
         if roomName and clientId and msg.toId then
            local target = rooms[roomName][msg.toId]
            if target and target.sock then
               local relayMsg = {}
               for k, v in pairs(msg) do relayMsg[k] = v end
               relayMsg.fromId = clientId
               target.sock:write(ba.json.encode(relayMsg), true)
            end
         end
      end
      ::continue::
   end
end

sock:event(onData)

?>
