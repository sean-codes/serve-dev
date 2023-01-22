var canvas = document.querySelector('canvas')
canvas.width = window.innerWidth
canvas.height = window.innerHeight
var ctx = canvas.getContext('2d')


var particles = []
var space = 50
var size = 10
var cols = Math.floor(canvas.width/space)
var rows = Math.floor(canvas.height/space)

var speed = 0
var accel = 0.001
var maxSpeed = 0.1

for (var x = 0; x < cols; x++) {
   for (var y = 0; y < rows; y++) {
      particles.push({
         x: x * space,
         y: y * space,
         color: `rgba(0, ${Math.random() * 255}, 0, 0.25)`,
      })
   }
}


setInterval(render, 1000/60)
setInterval(shuffle, 2000)

var offMax = 2
var offx = 1
var offy = 1
function shuffle() {
   speed = 0
   // particles = arrayScoot(particles, 1)
   // particles = arrayShuffle(particles, cols)
   // particles = arrayReverse(particles)
   offx = Math.floor(Math.random() * offMax - offMax/2) + 0.5
   offy = Math.floor(Math.random() * offMax - offMax/2) + 0.5
   // console.log(particles[0])
}

function render() {
   speed = Math.min(maxSpeed, speed + accel)
   ctx.clearRect(0, 0, canvas.width, canvas.height)
   for (var i in particles) {
      var particle = particles[i]
      
      var colPos = i % Math.floor(canvas.width/space) + offx
      var rowPos = Math.floor(i / cols) + offy
      var tx = colPos * space
      var ty = rowPos * space

      particle.x += (tx - particle.x) * speed
      particle.y += (ty - particle.y) * speed
      ctx.fillStyle = particle.color
      ctx.fillRect(
         particle.x + space / 2 - size / 2 , 
         particle.y + space / 2 - size / 2, 
         size,
         size
      )
   }
}




function arrayScoot(array, amount) {
   var newArray = []

   var currentIndex = amount - 1
   for (var i in array) {
      currentIndex += 1
      if (currentIndex == array.length-1) currentIndex = 0
      console.log(currentIndex)
      newArray.push({ ...array[currentIndex] })
   }


   return newArray

}

function arrayReverse(array) {
   return [...array].reverse()
}

function arrayShuffle(array) {
   var shuffler = []
   for (var i in array) {
      shuffler.push({
         item: { ...array[i] },
         pos: Math.random()
      })
   }

   return shuffler
      .sort((a, b) => a.pos > b.pos ? -1 : 1)
      .map(s => s.item)
}