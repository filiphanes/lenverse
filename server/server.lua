local socket = require("socket")
local copas = require("copas")
local lfs = require("lfs")
local websocket = require("websocket")
local mime = require("mime") -- LuaSocket's mime module
local http = require("socket.http")
local url = require("socket.url")

-- Configuration
local base_dir = "."
local listen = os.getenv("LISTEN") or "127.0.0.1:5005"
local connections = {} -- Map of file paths to WebSocket connections
local connections_lock = {} -- Simple lock for thread safety

-- MIME type mapping
local mime_types = {
    [".html"] = "text/html",
    [".css"] = "text/css",
    [".js"] = "application/javascript",
    [".png"] = "image/png",
    [".jpg"] = "image/jpeg",
    [".md"] = "text/markdown",
    -- Add more as needed
}
local default_mime = "application/octet-stream"

-- Helper: Get absolute path
local function get_absolute_path(path)
    local abs_path = lfs.currentdir() .. "/" .. path
    return abs_path:gsub("/+", "/") -- Normalize path
end

-- Helper: Get file extension
local function get_extension(path)
    return path:match("%.(%w+)$") or ""
end

-- Helper: Serve directory listing as plain text
local function handle_file_list(response, dir)
    local entries, err = lfs.dir(dir)
    if not entries then
        response:write("HTTP/1.1 500 Internal Server Error\r\n\r\n" .. err)
        return
    end

    response:write("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n")
    for entry in entries do
        if entry ~= "." and entry ~= ".." then
            local full_path = dir .. "/" .. entry
            local attr = lfs.attributes(full_path)
            if attr.mode == "directory" then
                response:write(entry .. "/\n")
            elseif not entry:match("^%.") then
                response:write(entry .. "\n")
            end
        end
    end
end

-- Helper: Broadcast updates to WebSocket clients
local function broadcast_update(file_path, content)
    copas.lock(connections_lock) -- Lock for thread safety
    local conns = connections[file_path] or {}
    for _, conn in ipairs(conns) do
        pcall(function()
            conn:send_text(content)
        end)
    end
    copas.unlock(connections_lock)
end

-- Helper: Handle WebSocket connection
local function handle_websocket(client, file_path)
    local ws = websocket.new_from_socket(client)
    print("+WS " .. file_path)

    -- Add connection to the list
    copas.lock(connections_lock)
    connections[file_path] = connections[file_path] or {}
    table.insert(connections[file_path], ws)
    copas.unlock(connections_lock)

    -- Send current file content as the first message
    local file = io.open(file_path, "r")
    if file then
        local content = file:read("*all")
        file:close()
        ws:send_text(content)
    end

    -- Handle incoming WebSocket messages
    copas.addthread(function()
        while true do
            local message, opcode, err = ws:receive()
            if err or opcode ~= websocket.TEXT then
                break
            end
            -- Write message to file and broadcast
            local file = io.open(file_path, "w")
            if file then
                file:write(message)
                file:close()
                broadcast_update(file_path, message)
            end
        end
        ws:close()
        -- Remove connection
        copas.lock(connections_lock)
        for i, conn in ipairs(connections[file_path] or {}) do
            if conn == ws then
                table.remove(connections[file_path], i)
                break
            end
        end
        print("-WS " .. file_path)
        copas.unlock(connections_lock)
    end)
end

-- Main request handler
local function handle_request(client)
    copas.handle(client, function()
        local request = client:receive()
        if not request then
            client:close()
            return
        end

        -- Parse HTTP request
        local method, path = request:match("^(%w+) (.+) HTTP")
        path = path or "/"
        print(method .. " " .. path)
        local file_path = base_dir .. path
        file_path = file_path:gsub("/+", "/") -- Normalize path

        -- Check for WebSocket upgrade
        if request:match("Upgrade: websocket") then
            local ws = websocket.new_from_socket(client)
            handle_websocket(client, file_path)
            return
        end

        local response = client

        -- Handle HTTP methods
        if method == "GET" then
            if path == "/" then
                file_path = base_dir .. "/index.html"
            end

            local attr = lfs.attributes(file_path)
            if not attr then
                -- Try globbing for files
                local pattern = file_path
                local found = false
                for file in lfs.dir(base_dir) do
                    if file:match(pattern) then
                        response:write("HTTP/1.1 302 Found\r\nLocation: /" .. file .. "\r\n\r\n")
                        found = true
                        break
                    end
                end
                if not found then
                    response:write("HTTP/1.1 404 Not Found\r\n\r\nFile not found")
                end
                client:close()
                return
            end

            if attr.mode == "directory" then
                handle_file_list(response, file_path)
            else
                local file = io.open(file_path, "r")
                if not file then
                    response:write("HTTP/1.1 500 Internal Server Error\r\n\r\nCannot read file")
                    client:close()
                    return
                end
                local content = file:read("*all")
                file:close()

                local ext = get_extension(file_path):lower()
                local content_type = mime_types[ext] or default_mime
                response:write("HTTP/1.1 200 OK\r\nContent-Type: " .. content_type ..
                              "\r\nAccess-Control-Allow-Origin: *\r\n\r\n" .. content)
            end

        elseif method == "PUT" then
            -- Read request body
            local content_length = request:match("Content%-Length: (%d+)")
            content_length = content_length and tonumber(content_length) or 0
            local body = client:receive(content_length)

            -- Write to file
            local file = io.open(file_path, "w")
            if not file then
                response:write("HTTP/1.1 500 Internal Server Error\r\n\r\nCannot write file")
                client:close()
                return
            end
            file:write(body)
            file:close()

            broadcast_update(file_path, body)
            response:write("HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\n\r\n")

        elseif method == "OPTIONS" then
            response:write("HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\n" ..
                          "Access-Control-Allow-Methods: GET, HEAD, PUT, OPTIONS\r\n" ..
                          "Access-Control-Allow-Headers: Content-Type\r\n\r\n")

        else
            response:write("HTTP/1.1 405 Method Not Allowed\r\n\r\n")
        end

        client:close()
    end)
end

-- Start the server
local function main()
    local server = socket.bind("127.0.0.1", tonumber(listen:match(":(%d+)$")) or 5005)
    print("Listening on http://" .. listen .. "/")
    print("Serving from " .. get_absolute_path(base_dir))

    copas.loop(function()
        local client = server:accept()
        handle_request(client)
    end)
end

-- Run the server
local ok, err = pcall(main)
if not ok then
    print("Error starting server: " .. err)
end
