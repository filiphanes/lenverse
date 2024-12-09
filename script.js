function connectToFileWebSocket(path, onUpdateCallback) {
    const ws = new WebSocket(`ws://${window.location.host}${path}`);
    const o = {}

    ws.onopen = () => {
        console.log(`WebSocket connected to ${path}`);
        o.ws = ws;
    };

    if (typeof onUpdateCallback === "function") {
        ws.onmessage = ({data}) => {
            onUpdateCallback(data);
        }
    }

    ws.onclose = () => {
        console.log(`WebSocket connection to ${path} closed`);
        // Reconnect after a delay
        setTimeout(() => connectToFileWebSocket(path, onUpdateCallback), 1000);
        o.send = null;
    };

    ws.onerror = (error) => {
        console.error(`WebSocket error on ${path}:`, error);
    };

    return o;
}

async function GET(path) {
    try {
        const res = await fetch(path);
        if (res.ok) {
            return res.text();
        } else {
            return "";
        }
    } catch (error) {
        console.error("Error GET", path, error);
    }
}

async function PUT(path, body) {
    try {
        await fetch(path, {
            method: "PUT",
            headers: { "Content-Type": "text/plain" },
            body: body,
        });
    } catch (error) {
        console.error("Error PUT", path, error);
    }
}

function handleKeyDown(event) {
    if (event.key === "ArrowUp" && selectedLyricIndex > 0) {
        selectLyric(selectedLyricIndex - 1);
    } else if (event.key === "ArrowDown" && selectedLyricIndex < lyrics.length - 1) {
        selectLyric(selectedLyricIndex + 1);
    } else if (event.key === "H") {
        hideLyric();
    }
}