-- G3 screenshots: copied by screenshot.js into the run's write dir and loaded by BAR as a user widget.
-- Once the map has rendered it hides the interface, saves overview.png, mid.png and close.png from fixed camera
-- presets into the write dir, and quits. [MapCheck] lines report each shot to screenshot.js.
function widget:GetInfo()
	-- lowest layer: its DrawScreenPost runs last, after every other widget has drawn
	return { name = "BAR Map Studio screenshots", desc = "Saves G3 screenshots, then quits", layer = -1000000, enabled = true }
end

local START_FRAME = 150 -- 5 s of game time: textures, splats, features, lava and the commanders are drawn
local SETTLE_DRAWS = 60 -- frames drawn after moving the camera before saving (terrain LOD, shadows)
local FOV = 45 -- vertical, degrees
local MID_DIST, CLOSE_DIST = 3500, 1000 -- elmos from the camera to its target; fixed, so every map shows the same scale

local PI = math.pi

-- Spring camera aimed at ground point (x, z): `pitch` below the horizon, `yaw` 0 looks north (-z), pi/2 east.
local function springCam(x, z, dist, pitch, yaw, fov)
	return { name = "spring", mode = 2, px = x, py = Spring.GetGroundHeight(x, z), pz = z, dist = dist,
		rx = PI / 2 + pitch, ry = yaw, rz = 0, fov = fov or FOV }
end

-- The whole map from the south at 80 degrees through a 60-degree lens: the distance at which the map's outline,
-- lifted to its highest ground (high edges sit closer to the camera, so they spread further), just fits the
-- view, plus 5%. The north and south edges bound the view's height, the south corners its width. The wider lens
-- keeps that distance under the engine's cap for the spring camera (about 1.33 x the longer map side).
local function overview(w, h, aspect)
	local pitch, fov = math.rad(80), 60
	local sin, cos, tanV = math.sin(pitch), math.cos(pitch), math.tan(math.rad(fov / 2))
	local _, maxHeight = Spring.GetGroundExtremes()
	local lift = math.max(maxHeight - Spring.GetGroundHeight(w / 2, h / 2), 0)
	local southDepth = lift * sin + h / 2 * cos -- how much closer than the target the lifted south edge is
	local fit = math.max(
		(h / 2 * sin - lift * cos) / tanV + southDepth,
		(h / 2 * sin + lift * cos) / tanV + lift * sin - h / 2 * cos,
		w / 2 / (tanV * aspect) + southDepth)
	return springCam(w / 2, h / 2, 1.05 * fit, pitch, 0, fov)
end

-- Low over team 0's start position, looking towards the map centre: the base area and what lies ahead of it.
local function close(w, h)
	local sx, _, sz = Spring.GetTeamStartPosition(0)
	local dx, dz = w / 2 - sx, h / 2 - sz
	local len = math.max(math.sqrt(dx * dx + dz * dz), 1)
	local pitch = math.rad(30)
	local ahead = CLOSE_DIST * math.cos(pitch) -- puts the camera right above the start position
	return springCam(sx + dx / len * ahead, sz + dz / len * ahead, CLOSE_DIST, pitch, math.atan2(dx, -dz))
end

local shots -- { {name, camera} } in order, made at START_FRAME
local current, draws = 1, 0

local function echo(fmt, ...)
	Spring.Echo("[MapCheck] " .. fmt:format(...))
end

-- how many of the map's four corners (on the ground) project inside the window
local function cornersInView(vsx, vsy)
	local count = 0
	for _, x in ipairs({ 0, Game.mapSizeX }) do
		for _, z in ipairs({ 0, Game.mapSizeZ }) do
			local px, py, pz = Spring.WorldToScreenCoords(x, Spring.GetGroundHeight(x, z), z)
			if pz <= 1 and px >= 0 and px <= vsx and py >= 0 and py <= vsy then
				count = count + 1
			end
		end
	end
	return count
end

function widget:Initialize()
	Spring.SendCommands("hideinterface 1")
end

function widget:GameFrame(frame)
	if shots or frame < START_FRAME then
		return
	end
	local w, h = Game.mapSizeX, Game.mapSizeZ
	local vsx, vsy = Spring.GetViewGeometry()
	local sx, _, sz = Spring.GetTeamStartPosition(0)
	echo("frame=%d mapSizeX=%d mapSizeZ=%d startX=%d startZ=%d", frame, w, h, sx, sz)
	shots = {
		{ "overview", overview(w, h, vsx / vsy) },
		{ "mid", springCam(w / 2, h / 2, MID_DIST, math.rad(45), 0) },
		{ "close", close(w, h) },
	}
end

function widget:DrawScreenPost()
	local shot = shots and shots[current]
	if not shot then
		return
	end
	local name, camera = shot[1], shot[2]
	if draws < SETTLE_DRAWS then
		Spring.SetCameraState(camera, 0)
		draws = draws + 1
		return
	end
	local vsx, vsy = Spring.GetViewGeometry()
	echo("%sDist=%d %sCorners=%d", name, Spring.GetCameraState().dist, name, cornersInView(vsx, vsy))
	if not Spring.IsGUIHidden() then
		echo("%s=interfaceVisible", name)
	elseif gl.SaveImage(0, 0, vsx, vsy, name .. ".png", { alpha = false }) == false then
		echo("%s=saveFailed", name)
	else
		echo("%s=saved", name)
	end
	current, draws = current + 1, 0
	if not shots[current] then
		Spring.SendCommands("quitforce")
	end
end
