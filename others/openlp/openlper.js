const baseUrl = 'http://192.168.2.17:4316';
let song = {};
let currentSlide= "";
let currentText = "hoj";

async function pollApi() {
    try {
        const response = await fetch(baseUrl+'/api/poll');
        const data = await response.json();
        console.log(data);
        const { isAuthorised, blank, item, slide } = data.results;

        if (!isAuthorised) {
            console.warn("Not authorized to access OpenLP API.");
            return;
        }

        updateSlideText(blank ? song.slides[slide].text : "");
        if (item !== song.item) {
            await refreshTextSlides(item);
        }
    } catch (error) {
        console.error("Error polling API:", error);
    }
}

// Function to refresh text slides from /api/controller/live/text
async function refreshTextSlides(itemGuid) {
    try {
        const response = await fetch(baseUrl+'/api/controller/live/text');
        const data = await response.json();
        console.log(data);
        song = data.results;
    } catch (error) {
        console.error("Error refreshing text slides:", error);
    }
}

// Function to update the current slide text
function updateSlideText(newText) {
    if (newText != currentText) {
        currentText = newText;
        console.log("Updated slide text:", currentText);
    }
}

refreshTextSlides();
// Start polling at a regular interval
setInterval(pollApi, 1000);
