
//
// Snow simulator
//	- Noq
//

// Screen / Canvas definitions
var i;
var j;
var k;
const w = window;
const s = screen;
const margin = {x: (w.innerWidth / 20), y: (w.innerHeight / 10)};
const c = document.getElementById("canvas");
c.height = w.innerHeight;// - margin.y;
c.width = w.innerWidth;//c.height + margin.x;
const ctx = c.getContext("2d");
var screen = {
	r: 30, g: 30, b: 30, color: 30//r: 150, g: 150, b: 170
}


// Variables / Arrays / Objects
var trail = "true";
var alpha;
var drops = [new Drop()];

// Loop
function loop() {

	// Drawing
	var screenr = screen.color;
	var screeng = screen.color - 10;
	var screenb = screen.color + 10;
	ctx.fillStyle = 'rgba(' + screenr + ', ' + screeng + ', ' + screenb +  ', 1)';
	ctx.fillRect(0, 0, c.width, c.height);

	var i;
	for (i = 0; i < drops.length; i ++) {

		// Rendering
		ctx.fillStyle = 'rgba(' + drops[i].color + ', ' + drops[i].color + ', ' + drops[i].color + ', 1)';
		drops[i].move();
		drops[i].accel();
		ctx.fillRect(drops[i].x, drops[i].y, drops[i].size, drops[i].size);
		ctx.fillStyle = 'rgba(' + drops[i].color + ', ' + drops[i].color + ', ' + drops[i].color + ', 0.5)'
		ctx.fillRect(
			drops[i].x - drops[i].border, 
			drops[i].y - drops[i].border, 
			drops[i].size + drops[i].border * 2,
			drops[i].size + drops[i].border * 2
		);

		// Motion trail / blur
		if (trail == "true") {
			drops[i].trail.x.push(drops[i].x);
			drops[i].trail.y.push(drops[i].y);
		}
		var j; for (j = 1; j < drops[i].trail.x.length; j ++) {
			alpha = 1 / j;
			ctx.fillStyle = 'rgba(' + drops[i].color + ', ' + drops[i].color + ', ' + drops[i].color + ', ' + j / drops[i].trail.cap + ')'
			ctx.fillRect(drops[i].trail.x[j], drops[i].trail.y[j], drops[i].size, drops[i].size);
		}
		if (drops[i].trail.x.length > drops[i].trail.cap) {
			drops[i].trail.x.shift();
			drops[i].trail.y.shift();
		}

	}

}

setInterval(loop, 20);
setInterval(addDrop, 100);


// Functions, classes

function rand(n) {
	return(Math.floor((Math.random() * n) + 1));
}

function Drop() {
	this.size = 1.5 + rand(2.5);
	this.border = this.size / 2;
	this.x = rand(c.width);
	this.y = - this.size - this.border;
	this.moving = "true";
	this.speed = {
		x: rand(2) - 0.5,
		y: rand(2) + 2
	}
	this.dir = ["left", "right"];
	this.color = rand(85) + 170;
	this.trail = {
		x: [],
		y: [],
		cap: 3
	}
	this.move = function() {
		this.x += this.speed.x;
		this.y += this.speed.y;
		var i;
		for (i = 0; i < drops.length; i ++) {
			if (drops[i].y > c.height + this.size + this.border
				 || drops[i].x < - this.size - this.border
				 || drops[i] > c.width + this.size + this.border) {
				drops[i] = new Drop();
			}
		}
		if (this.x > c.width) {
			this.x = 0;
		}
		this.speed.y += (rand(2) - 1.5) / 5;
	}
	this.wind = "rand";
	this.accel = function(e) {
		if (this.wind == "rand") {
			this.speed.x += (rand(2) - 1.5) / 7;
		} else if (this.wind == "left") {
			this.speed.x -= (rand(2) - 1) / 7;
		} else if (this.wind == "right") {
			this.speed.x += (rand(2) - 1) / 7;
		}
	}
}

function addDrop() {
	var cap = 1000;
	if (drops.length < cap) {
		drops.push(new Drop());
	}
}