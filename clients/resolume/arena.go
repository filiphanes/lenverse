package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type Config struct {
	LenVerse struct {
		Host string `json:"host"`
		Port int    `json:"port"`
	} `json:"lenverse"`
	Arena struct {
		Host        string   `json:"host"`
		Port        int      `json:"port"`
		ClipA       Clip     `json:"clipA"`
		ClipB       Clip     `json:"clipB"`
		ClipClear   *Clip    `json:"clipClear"`
		Conversions []string `json:"conversions"`
	} `json:"arena"`
}

type Clip struct {
	Layer  int `json:"layer"`
	Column int `json:"column"`
}

var (
	config Config
	clip   Clip
)

func loadConfig() {
	data, err := os.ReadFile("./config.json")
	if err != nil {
		log.Fatalf("Failed to read config file: %v", err)
	}
	if err := json.Unmarshal(data, &config); err != nil {
		log.Fatalf("Failed to parse config: %v", err)
	}
}

func lenverseConnect() {
	url := fmt.Sprintf("ws://%s:%d/current/verse.txt", config.LenVerse.Host, config.LenVerse.Port)
	log.Println("Connecting to LenVerse", url)

	for {
		ws, _, err := websocket.DefaultDialer.Dial(url, nil)
		if err != nil {
			log.Printf("Failed to connect: %v, retrying in 1 second...", err)
			time.Sleep(1 * time.Second)
			continue
		}
		log.Println("/current/verse.txt connected")

		handleMessages(ws)
		ws.Close()
	}
}

func handleMessages(ws *websocket.Conn) {
	for {
		_, message, err := ws.ReadMessage()
		if err != nil {
			log.Printf("Connection error: %v", err)
			return
		}

		text := applyConversions(string(message), config.Arena.Conversions)
		log.Println(">", text)

		if text == "" && config.Arena.ClipClear != nil {
			clip = *config.Arena.ClipClear
		} else {
			clip = switchClip(clip, config.Arena.ClipA, config.Arena.ClipB)
		}

		if err := requestArena(http.MethodPut, fmt.Sprintf("/api/v1/composition/layers/%d/clips/%d", clip.Layer, clip.Column),
			map[string]interface{}{"video": map[string]interface{}{"sourceparams": map[string]string{"Text": text}}}); err != nil {
			log.Printf("Failed to update clip: %v", err)
		}
		if err := requestArena(http.MethodPost, fmt.Sprintf("/api/v1/composition/layers/%d/clips/%d/connect", clip.Layer, clip.Column), nil); err != nil {
			log.Printf("Failed to connect clip: %v", err)
		}
	}
}

func switchClip(current, clipA, clipB Clip) Clip {
	if current == clipA {
		return clipB
	}
	return clipA
}

func applyConversions(text string, conversions []string) string {
	for _, conversion := range conversions {
		switch conversion {
		case "trim-dots":
			text = strings.Trim(text, ".")
		case "trim-commas":
			text = strings.Trim(text, ",")
		case "remove-newlines":
			text = strings.ReplaceAll(text, "\n", " ")
		case "remove-verses":
			text = strings.ReplaceAll(text, "\u0001", "")
		case "remove-numbers":
			text = strings.Map(func(r rune) rune {
				if r >= '0' && r <= '9' {
					return -1
				}
				return r
			}, text)
		case "upper":
			text = strings.ToUpper(text)
		case "lower":
			text = strings.ToLower(text)
		case "caps":
			text = strings.Title(strings.ToLower(text))
		}
	}
	return text
}

func requestArena(method, path string, body interface{}) error {
	url := fmt.Sprintf("http://%s:%d%s", config.Arena.Host, config.Arena.Port, path)
	var jsonBody []byte
	var err error

	if body != nil {
		jsonBody, err = json.Marshal(body)
		if err != nil {
			return fmt.Errorf("failed to marshal body: %w", err)
		}
	}

	req, err := http.NewRequest(method, url, io.NopCloser(bytes.NewReader(jsonBody)))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("server returned error: %s", resp.Status)
	}

	return nil
}

func main() {
	loadConfig()
	log.Printf("Config: %+v\n", config)
	lenverseConnect()
}
