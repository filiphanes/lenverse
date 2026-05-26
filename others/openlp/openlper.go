package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

type PollResponse struct {
	Results struct {
		IsAuthorised bool   `json:"isAuthorised"`
		Blank        bool   `json:"blank"`
		Item         string `json:"item"`
		Slide        int    `json:"slide"`
	} `json:"results"`
}

type LiveTextResponse struct {
	Results struct {
		Item   string `json:"item"`
		Slides []struct {
			Text string `json:"text"`
		} `json:"slides"`
	} `json:"results"`
}

var (
	baseUrl      = "http://192.168.2.17:4316"
	song         = LiveTextResponse{}
	currentText  = ""
	pollDuration = 100 * time.Millisecond
)

func pollApi() {
	resp, err := http.Get(baseUrl + "/api/poll")
	if err != nil {
		log.Println("Error polling API:", err)
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Println("Error reading response body:", err)
		return
	}

	var data PollResponse
	err = json.Unmarshal(body, &data)
	if err != nil {
		log.Println("Error unmarshalling JSON:", err)
		return
	}

	if !data.Results.IsAuthorised {
		log.Println("Not authorized to access OpenLP API.")
		return
	}

	if data.Results.Blank {
		updateSlideText("")
	} else if len(song.Results.Slides) > data.Results.Slide {
		updateSlideText(song.Results.Slides[data.Results.Slide].Text)
	}

	if data.Results.Item != song.Results.Item {
		refreshTextSlides()
	}
}

func refreshTextSlides() {
	resp, err := http.Get(baseUrl + "/api/controller/live/text")
	if err != nil {
		log.Println("Error refreshing text slides:", err)
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Println("Error reading response body:", err)
		return
	}

	var data LiveTextResponse
	err = json.Unmarshal(body, &data)
	if err != nil {
		log.Println("Error unmarshalling JSON:", err)
		return
	}

	song = data
}

func updateSlideText(newText string) {
	if newText != currentText {
		currentText = newText
		fmt.Println("Updated slide text:", currentText)
	}
}

func main() {
	go func() {
		for {
			pollApi()
			time.Sleep(pollDuration)
		}
	}()

	refreshTextSlides()

	select {} // Prevent the main function from exiting
}
