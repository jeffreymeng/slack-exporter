import axios from "axios";
import { promises as fs } from "fs";
import * as queryString from "query-string";
import * as dotenv from "dotenv";
import { channel } from "diagnostics_channel";

dotenv.config();

let counter = 0;
async function get(
	path: string,
	options: Record<string, any>
): Promise<Record<string, any>> {
	return await axios
		.get(
			`https://slack.com/api${path}?${queryString.stringify({
				...options,
			})}`,
			{
				headers: {
					Authorization: `Bearer ${process.env.SLACK_TOKEN}`,
				},
			}
		)
		.then((response) => response.data)
		.catch((error) => {
			if (error.response) {
				console.log(error.response.data);
				console.log(error.response.status);
				console.log(error.response.headers);
			} else if (error.request) {
				console.log(error.request);
			} else {
				console.log("Error", error.message);
			}
			console.log(error.config);
		});
}
async function paginatedGet(
	path: string,
	key: string,
	options: Record<string, any>,
	startCursor?: string
): Promise<Record<string, any>[]> {
	const data = await get(path, {
		...options,
		cursor: startCursor,
	});

	const cursor = data.response_metadata?.next_cursor;

	counter++;
	console.log(`got data: ${counter}`);

	if (!data[key]) {
		throw new Error("Expected data with key: " + key);
	}

	if (!cursor) {
		return data[key];
	} else {
		return [
			...data[key],
			...(await paginatedGet(path, key, options, cursor)),
		];
	}
}

async function getMembers(): Promise<Record<string, any>[]> {
	return paginatedGet("/users.list", "members", {
		limit: 250,
	});
}

async function getChannels(): Promise<Record<string, any>[]> {
	return paginatedGet("/conversations.list", "channels", {
		types: "public_channel,private_channel,mpim,im",
	});
}
async function getChannel(id: string): Promise<Record<string, any>> {
	return {
		info: (
			await get("/conversations.info", {
				channel: id,
			}).then((data) => {
				if (!data.channel) {
					console.log("NO CHANNEL");
					console.log(data);
				}
				return data;
			})
		).channel,
		messages: await paginatedGet("/conversations.history", "messages", {
			channel: id,
			limit: 1000, // per page
		}),
	};
}

enum ChannelType {
	PRIVATE_CHANNEL = "private-channel",
	PUBLIC_CHANNEL = "public-channel",
	GROUP_DM = "group-dm",
	INDIVIDUAL_DM = "individual-dm",
}
const channelTypeMap = {
	[ChannelType.PUBLIC_CHANNEL]: "public-channels",
	[ChannelType.PRIVATE_CHANNEL]: "private-channels",
	[ChannelType.GROUP_DM]: "group-dms",
	[ChannelType.INDIVIDUAL_DM]: "individual-dms",
};
function getType(channelObj: Record<string, any>): ChannelType {
	if (channelObj.is_mpim) {
		return ChannelType.GROUP_DM;
	} else if (channelObj.is_group) {
		return ChannelType.PRIVATE_CHANNEL;
	} else if (channelObj.is_im) {
		return ChannelType.INDIVIDUAL_DM;
	} else if (channelObj.is_channel) {
		return ChannelType.PUBLIC_CHANNEL;
	} else {
		throw new Error("Unexpected channel type");
	}
}
async function exportAllChannels(): Promise<void> {
	await fs.rm("./out", {
		force: true,
		recursive: true,
	});
	await fs.mkdir("./out");
	await Promise.all(
		[
			"./out/public-channels",
			"./out/private-channels",
			"./out/individual-dms",
			"./out/group-dms",
		].map(async (path) => {
			await fs.mkdir(path);
			await fs.mkdir(path + "/archived");
		})
	);
	console.log("done creating stuff");

	const [channels, members] = await Promise.all([
		getChannels().then((channels) => {
			fs.writeFile(
				"./out/channels.json",
				JSON.stringify(channels, null, 4)
			);
			return channels;
		}),
		getMembers().then((members) => {
			fs.writeFile(
				"./out/members.json",
				JSON.stringify(members, null, 4)
			);
			return members;
		}),
	]);

	const memberIdMap = members.reduce(
		(obj, member) => ({
			...obj,
			[member.id]: {
				username: member.name,
				realName: member.real_name,
				email: member.profile.email,
				image: member.profile.image_512,
			},
		}),
		{}
	);

	for (const channel of channels) {
		const id = channel.id;
		const type = getType(channel);
		if (type == ChannelType.INDIVIDUAL_DM && !memberIdMap[channel.user]) {
			console.log(channel);
		}
		// console.log(memberIdMap)
		const name =
			type === ChannelType.INDIVIDUAL_DM
				? `dm_${memberIdMap[channel.user].realName}`
				: channel.name_normalized;
		const archived = channel.is_archived;

		console.log(`Fetching channel ${channelTypeMap[type]} ${name}__${id}`);

		const channelData = await getChannel(id);
		fs.writeFile(
			`./out/${channelTypeMap[type]}${
				archived ? "/archived" : ""
			}/${name}__${id}.json`,
			JSON.stringify(channelData, null, 4)
		);
	}
}
async function main() {
	// console.log(await getMembers());
	exportAllChannels();
}
main();
