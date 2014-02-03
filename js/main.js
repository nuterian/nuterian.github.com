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

$(document).ready(function(){

    /** 
     * This part does the "fixed navigation after scroll" functionality
     * We use the jQuery function scroll() to recalculate our variables as the 
     * page is scrolled/
     */
    $(window).scroll(function(){
        var window_top = $(window).scrollTop(); // the "12" should equal the margin-top value for nav.stick
    });

    /**
     * This part causes smooth scrolling using scrollto.js
     * We target all a tags inside the nav, and apply the scrollto.js to it.
     */
    $("#nav a").click(function(e){
        e.preventDefault();
        $('html,body').scrollTo(this.hash, this.hash); 
    });

    /**
     * This part handles the highlighting functionality.
     * We use the scroll functionality again, some array creation and 
     * manipulation, class adding and class removing, and conditional testing
     */
    var aChildren = $("#nav a"); // find the a children of the list items
    var aArray = []; // create the empty aArray
    for (var i=0; i < aChildren.length; i++) {    
        var aChild = aChildren[i];
        var ahref = $(aChild).attr('href');
        aArray.push(ahref);
    } // this for loop fills the aArray with attribute href values

    var $curPage = aArray[0];
    
    $(window).scroll(function(){
        var windowPos = $(window).scrollTop(); // get the offset of the window from the top of page
        var windowHeight = $(window).height(); // get the height of the window
        var docHeight = $(document).height();

        for (var i=0; i < aArray.length; i++) {
            var theID = aArray[i];
            var divPos = $(theID).offset().top; // get the offset of the div from the top of page
            var divHeight = $(theID).height(); // get the height of the div in question
            if (windowPos >= divPos && windowPos < (divPos + divHeight)) {
                $("a[href='" + theID + "']").addClass("current");
            } else {
                $("a[href='" + theID + "']").removeClass("current");
            }
        }

        if(windowPos + windowHeight == docHeight) {
            if (!$("#nav a:last-child").hasClass("current")) {
                var navActiveCurrent = $(".current").attr("href");
                $("a[href='" + navActiveCurrent + "']").removeClass("current");
                $("#nav a:last-child").addClass("current");
            }
        }
    });
});