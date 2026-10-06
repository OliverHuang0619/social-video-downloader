use framework "Foundation"
use framework "AppKit"
use scripting additions

on run argv
	if (count of argv) is 0 then error "没有要分享的文件"
	set fileURLs to current application's NSMutableArray's array()
	repeat with filePath in argv
		set fileURL to (current application's NSURL's fileURLWithPath:(filePath as text))
		(fileURLs's addObject:fileURL)
	end repeat
	set sharingService to current application's NSSharingService's sharingServiceNamed:(current application's NSSharingServiceNameSendViaAirDrop)
	if sharingService is missing value then error "这台 Mac 不能使用 AirDrop"
	current application's NSApplication's sharedApplication()'s activateIgnoringOtherApps:true
	sharingService's performWithItems:fileURLs
	delay 180
end run
