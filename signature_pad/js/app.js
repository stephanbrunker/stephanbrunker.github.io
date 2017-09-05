var 	wrapper = document.getElementById("signature-pad"), 
		clearButton = document.getElementById("clear"),  
		saveButton = document.getElementById("save"), 
		canvas = wrapper.querySelector("canvas"), 
		signaturePad; 
		
function resizeCanvas() 
{ 
	// When zoomed out to less than 100%, for some very strange reason, 
	// some browsers report devicePixelRatio as less than 1 
	// and only part of the canvas is cleared then. 
	var ratio =  Math.max(window.devicePixelRatio || 1, 1); 
	canvas.width = canvas.offsetWidth * ratio; 
	canvas.height = canvas.offsetHeight * ratio; 
	canvas.getContext("2d").scale(ratio, ratio); 
} 
 
 
window.onresize = resizeCanvas; 
resizeCanvas(); 

signaturePad = new SignaturePad(canvas);
	  
clearButton.addEventListener("click", 
	function (event) 
	{ 
    signaturePad.clear(); 
	}); 
 

saveButton.addEventListener("click", 
	function (event) 
	{ 
		if (signaturePad.isEmpty()) { alert("Please provide signature first."); } 
		else 
		{ 
			var postdata = document.getElementById("img-data");
			postdata.value = signaturePad.toDataURL();
		} 
	});
