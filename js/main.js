var previews = document.getElementsByClassName('grid-item');
var showcase = document.getElementById('showcase');
var shows = document.getElementsByClassName('show-item');
var pages = document.getElementsByClassName('page');

function updatePages(){
	for(var i=0; i<pages.length; i++){
		pages[i].setAttribute("style", "height:"+window.innerHeight+"px;");
	}		
}

updatePages(); 
window.onresize = function(e){
	updatePages();
}

var curShow;

showcase.addEventListener('click', function(){

	showcase.className = 'overlay page';
	document.body.className = '';
	curShow.className = 'show-item';
});

for(var i=0; i<previews.length; i++){
	previews[i].addEventListener("click", function(e){
		document.body.className = 'noscroll';
		for(var j=0; j<shows.length; j++){
			var sid = shows[j].getAttribute("data-id");
			var pid = this.getAttribute("data-id");
			if( sid == pid){
				shows[j].className = 'show-item visible';
				curShow = shows[j];
			}
		}
		showcase.className = 'overlay page visible';
		e.preventDefault();
	});
}