const container = document.querySelector('.container');

for(var i = 1; i <= 150; i++) {
  const block = document.createElement('div');
  block.classList.add('block');
  container.appendChild(block);
}

function generateBlocks() {
  
  anime({
    targets : '.block',
    duration: 3000,
    translateX : function() {
      return anime.random(-1000, 1000)
    },
    translateY : function() {
      return anime.random(-600, 600)
    },
    scale : function() {
      return anime.random(1, 3)
    }
  });
}

generateBlocks();
