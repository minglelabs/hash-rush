-- Where the web game's own sounds are (src/client/audio.js, music.js), as
-- tools/audio renders them and Roblox holds them once uploaded. Written by
-- tools/audio/build.py: run it again rather than editing this. Without ids
-- Fx plays Roblox's own sounds in their place.
return {
	effects = 85219973142525,
	-- One loudness for effects and music: the balance the web game has.
	volume = 1,
	-- Each effect: where it starts in the effects file and how long it is, in seconds.
	sprite = {
		swing = { 0, 0.0899 },
		bonk = { 0.3899, 0.1695 },
		toss = { 0.8594, 0.1788 },
		double = { 1.3382, 0.3982 },
		triple = { 2.0364, 0.98 },
		superplay = { 3.3164, 1 },
		spawn = { 4.6164, 0.1199 },
		seed = { 5.0363, 0.6798 },
		siren = { 6.0161, 1.0894 },
		tick = { 7.4055, 0.0546 },
		tock = { 7.7601, 0.0547 },
		count = { 8.1148, 0.2382 },
		go = { 8.653, 1.1197 },
		overtime = { 10.0727, 1.54 },
		fanfare = { 11.9127, 2.94 },
		cheer = { 15.1527, 4.8087 },
		win = { 20.2614, 0.579 },
		lose = { 21.1404, 0.6885 },
		chat = { 22.1289, 0.1697 },
	},
	music = {
		-- The round tunes back to back, in files short enough for Roblox, played
		-- one after the other; each tune starts where it says in its file.
		game = {
			{ id = 121944402092878, starts = { 0.0, 121.739, 238.406 } }, -- game, hop, sprint
			{ id = 113812252161376, starts = { 0.0, 127.273, 247.273 } }, -- tango, boogie, parade
		},
		lobby = { id = 134905893616866 },
	},
}
