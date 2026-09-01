// Current language
var curLang;
var showAll;

function dxBeforePrint(){

	var i;

	if (window.text) document.all.text.style.height = "auto";
			
	for (i=0; i < document.all.length; i++){
		if (document.all[i].tagName == "BODY") {
			document.all[i].scroll = "yes";
			}
		if (document.all[i].id == "pagetop") {
			document.all[i].style.margin = "0px 0px 0px 0px";
			document.all[i].style.width = "100%";
			}
		if (document.all[i].id == "pagebody") {
			document.all[i].style.overflow = "visible";
			document.all[i].style.top = "5px";
			document.all[i].style.width = "100%";
			document.all[i].style.padding = "0px 10px 0px 30px";
			}
		if (document.all[i].id == "seealsobutton" || document.all[i].id == "languagesbutton") {
			document.all[i].style.display = "none";
			}
		if (document.all[i].className == "LanguageSpecific") {
			document.all[i].style.display = "block";
			}
		}
}

function dxAfterPrint(){

	 document.location.reload();

}

function showSeeAlsoBox(){

	hideSeeAlso();
	hideLanguage();

	var button = window.event.srcElement

	window.event.returnValue = false;
	window.event.cancelBubble = true;

	var div = document.all.dxseealsomenu;
	if (div && button) {
		div.style.pixelLeft = 0;
		div.style.pixelTop = button.offsetTop + button.offsetHeight;
		div.style.visibility = "visible";
	}
}

function showLanguageBox(){

	hideSeeAlso();
	hideLanguage();

	var button = window.event.srcElement

	window.event.returnValue = false;
	window.event.cancelBubble = true;

	var div = document.all.dxlanguagemenu;
	if (div && button) {
		div.style.pixelLeft = 0;
		div.style.pixelTop = button.offsetTop + button.offsetHeight;
		div.style.visibility = "visible";
	}
}

function setLanguageFilter(language){

	hideSeeAlso();
	hideLanguage();

	window.event.returnValue = false;
	window.event.cancelBubble = true;
	
	curLang = language;
	updateLanguageElements();
	
}

function bodyLoad(){

	var cLang;
	var i;
	var b;
	var l;
	var e;

	resizeBan();
	document.body.onclick = bodyClick;
	document.body.onresize = bodyResize;
	
	// Check the context window for current language.
	var cLang;
	try{
		for (i=1; i< window.external.ContextAttributes.Count; i++){
			if(window.external.ContextAttributes(i).Name.toUpperCase()=="DEVLANG"){
				var b = window.external.ContextAttributes(i).Values.toArray();
				cLang = b[0].toUpperCase();
			}
		}
	}
	catch(e){}
	
	if (cLang != null){
		if (cLang.indexOf("VB")!=-1) curLang = "VB";
		if (cLang.indexOf("VC")!=-1) curLang = "VC";
		if (cLang.indexOf("C#")!=-1) curLang = "CS";
		if (cLang.indexOf("JSCRIPT")!=-1) curLang = "JScript";
	}

	if (curLang == null){
		var l = "";
		var multipleLang = false;
		// Check to see what the help filter is set to.
		try {l = window.external.Help.FilterQuery.toUpperCase();}
		catch(e){}
		if (l.indexOf("VB")!=-1){
			cLang = "VB";
			}
		if (l.indexOf("VC")!=-1){
			if (cLang!=null) multipleLang = true;
			cLang = "VC";
			}
		if (l.indexOf("C#")!=-1){
			if (cLang!=null) multipleLang = true;
			cLang = "CS";
			}
		if (l.indexOf("JSCRIPT")!=-1){
			if (cLang!=null) multipleLang = true;
			cLang = "JScript";
			}
		if (multipleLang==false) curLang = cLang;
	}

	if (curLang != null)
		showAll = false;
		
	updateLanguageElements();
	
	window.onbeforeprint = dxBeforePrint;
	window.onafterprint = dxAfterPrint;
	
}

function updateLanguageElements(){

	if (!curLang) return;

	var pres = document.all.tags("DIV");
	var pre;

	if (pres) {
		for (var iPre = 0; iPre < pres.length; iPre++) {
			pre = pres[iPre];
			if (pre.Name && pre.className) {
				if (pre.className == "LanguageSpecific") {
					if (pre.Name.indexOf(curLang) != -1 || curLang == "All") {
						pre.style.display = "block";				
					}
					else {
						pre.style.display = "none";
					};
				}
			};
		}
	}
	
}

function bodyResize(){
	resizeBan();
}

function bodyClick(){
	hideSeeAlso();
	hideLanguage();
	resizeBan();
}

function hideSeeAlso(){
	if (document.all.dxseealsomenu) {
		document.all.dxseealsomenu.style.visibility = "hidden";
	};
}


function hideLanguage(){
	if (document.all.dxlanguagemenu) {
		document.all.dxlanguagemenu.style.visibility = "hidden";
	};
}

function resizeBan(){

	if (msieversion() > 4)
	{
		try
		{

			if (document.body.clientWidth==0) return;
			var oBanner= document.all.item("pagetop");
			var oText= document.all.item("pagebody");
			if (oText == null) return;
			var oBannerrow1 = document.all.item("projectnamebanner");
			var oTitleRow = document.all.item("pagetitlebanner");
			if (oBannerrow1 != null){
				var iScrollWidth = dxBody.scrollWidth;
				oBannerrow1.style.marginRight = 0 - iScrollWidth;
			}
			if (oTitleRow != null){
				oTitleRow.style.padding = "0px 10px 0px 22px; ";
			}
			if (oBanner != null){
				document.body.scroll = "no"
				oText.style.overflow= "auto";
				oBanner.style.width= document.body.offsetWidth-2;
				oText.style.paddingRight = "20px"; // Width issue code
				oText.style.width= document.body.offsetWidth-4;
				oText.style.top=0;  
				if (document.body.offsetHeight > oBanner.offsetHeight)
					oText.style.height= document.body.offsetHeight - (oBanner.offsetHeight+4) 
				else oText.style.height=0
			}	
			try{nstext.setActive();} //allows scrolling from keyboard as soon as page is loaded. Only works in IE 5.5 and above.
			catch(e){}

		}
		catch(e){}
	}
	
} 

function msieversion()
// Return Microsoft Internet Explorer (major) version number, or 0 for others.
// This function works by finding the "MSIE " string and extracting the version number
// following the space, up to the decimal point for the minor version, which is ignored.
{
    var ua = window.navigator.userAgent
    var msie = ua.indexOf ( "MSIE " )

    if ( msie > 0 )        // is Microsoft Internet Explorer; return version number
        return parseInt ( ua.substring ( msie+5, ua.indexOf ( ".", msie ) ) )
    else
        return 0    // is other browser
}