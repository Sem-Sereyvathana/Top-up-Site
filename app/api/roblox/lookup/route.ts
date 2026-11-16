import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";

export async function POST(req: Request) {
  try {
    // Each check costs an outbound call to Roblox's API — cap it so this
    // can't be used to scrape usernames or run up outbound requests.
    const ip = getClientIp(req);
    if (!(await checkRateLimit(`roblox-lookup:${ip}`, 15, 10 * 60 * 1000))) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a bit and try again." },
        { status: 429 }
      );
    }

    const { username } = await req.json();
    const name = typeof username === "string" ? username.trim() : "";

    if (!name || !/^[A-Za-z0-9_]{3,20}$/.test(name)) {
      return NextResponse.json({ error: "Enter a valid Roblox username." }, { status: 400 });
    }

    const userRes = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [name], excludeBannedUsers: false }),
      cache: "no-store",
    });

    if (!userRes.ok) {
      return NextResponse.json({ error: "Unable to check the Roblox account right now." }, { status: 502 });
    }

    const userData = await userRes.json();
    const user = userData?.data?.[0];

    if (!user?.id) {
      return NextResponse.json({ error: "Roblox account not found." }, { status: 404 });
    }

    const avatarRes = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar?userIds=${user.id}&size=150x150&format=Png&isCircular=false`,
      { cache: "no-store" }
    );
    const avatarData = avatarRes.ok ? await avatarRes.json() : null;
    const avatarUrl = avatarData?.data?.[0]?.imageUrl || "";

    return NextResponse.json({
      id: user.id,
      name: user.name,
      displayName: user.displayName || user.name,
      avatarUrl,
    });
  } catch {
    return NextResponse.json({ error: "Unable to check the Roblox account right now." }, { status: 500 });
  }
}
