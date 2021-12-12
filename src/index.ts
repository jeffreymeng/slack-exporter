import { promises as fs } from "fs";
import { config as dotenvConfig } from "dotenv";
import dayjs from "dayjs";
import escapeHtml from "escape-html";
import axios from "axios";
import {
	ConversationsHistoryResponse,
	ConversationsListResponse,
	UsersListResponse,
	WebClient,
} from "@slack/web-api";
import { Member } from "@slack/web-api/dist/response/UsersListResponse";
import getHTMLFile from "./htmlTemplate";
import wrapHTML from "./htmlTemplate";

dotenvConfig();

// Initialize
const slackapi = new WebClient(process.env.SLACK_TOKEN);

async function paginate(
	method: string,
	key: string,
	options: Record<string, any> = {},
	onPageGet?: (page: Record<string, any>[]) => void
): Promise<Record<string, any>[]> {
	const paginator = slackapi.paginate(method, {
		name: key,
		limit: 250, // can be overridden in options
		...options,
	});

	let data: Record<string, any>[] = [];
	for await (const page of paginator) {
		if (onPageGet) {
			onPageGet(page[key] as Record<string, any>[]);
		}
		data = [...data, ...(page[key] as Record<string, any>[])];
	}
	return data;
}

async function getMembers() {
	const members: UsersListResponse["members"] = await paginate(
		"users.list",
		"members"
	);
	if (!members) {
		throw new Error("Unable to fetch members.");
	}
	return members;
}
async function getChannels() {
	const channels: ConversationsListResponse["channels"] = await paginate(
		"conversations.list",
		"channels",
		{
			types: "public_channel,private_channel,mpim,im",
		}
	);
	if (!channels) {
		throw new Error("Unable to fetch channels");
	}
	return channels;
}

async function getChannelHistory(
	channelId: string,
	onPageGet?: (page: Record<string, any>[]) => void
) {
	const history: ConversationsHistoryResponse["messages"] = await paginate(
		"conversations.history",
		"messages",
		{
			channel: channelId,
			limit: 1000, // per page
		},
		onPageGet
	);
	if (!history) {
		throw new Error("Unable to fetch history for channel ID " + channelId);
	}
	return history;
}
async function getChannel(
	id: string,
	onPageGet?: (page: Record<string, any>[]) => void
) {
	return {
		info: await slackapi.conversations
			.info({
				channel: id,
			})
			.then((data) => {
				if (!data.channel) {
					throw new Error(
						"Unable to fetch channel data for id " + id
					);
				}
				return data.channel;
			}),
		messages: await getChannelHistory(id, onPageGet),
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

let lastProgressMessageLength = -1;

async function updateProgress(message: string) {
	if (lastProgressMessageLength === -1) {
		process.stdout.write(message);
	} else {
		process.stdout.write(
			"\r" +
				message +
				Array(Math.max(0, lastProgressMessageLength - message.length))
					.fill(" ")
					.join("")
		);
	}

	lastProgressMessageLength = message.length;
}
async function exportAllChannels(): Promise<void> {
	updateProgress("Setting up output directories...");
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
	updateProgress("Fetching channels and members...");

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
		(obj: Record<string, Member>, member: Member) => ({
			...obj,
			[member.id as string]: member,
		}),
		{}
	);
	let numMessagesExported = 0;
	let numChannelsExported = 0;
	updateProgress("Exporting...");
	await Promise.all(
		channels.map(async (channel) => {
			const id = channel.id;

			if (!id) {
				throw new Error("Unable to get ID of channel.");
			}

			const type = getType(channel);
			if (
				type == ChannelType.INDIVIDUAL_DM &&
				!memberIdMap[
					(channel as typeof channel & { user: string })
						.user as string
				]
			) {
				// console.log(channel);
			}
			// console.log(memberIdMap)
			const name =
				type === ChannelType.INDIVIDUAL_DM
					? `dm_${
							memberIdMap[
								(channel as typeof channel & { user: string })
									.user as string
							].real_name
					  }`
					: channel.name_normalized;
			const archived = channel.is_archived;

			// console.log(
			// 	`Fetching channel ${channelTypeMap[type]} ${name}__${id}`
			// );

			const channelData = await getChannel(id, (messages) => {
				numMessagesExported += messages.length;
				updateProgress(
					`Exported ${numMessagesExported} messages // ${numChannelsExported} channels`
				);
			});
			numChannelsExported++;
			updateProgress(
				`Exported ${numMessagesExported} messages // ${numChannelsExported} channels`
			);
			fs.writeFile(
				`./out/${channelTypeMap[type]}${
					archived ? "/archived" : ""
				}/${name}__${id}.json`,
				JSON.stringify(channelData, null, 4)
			);
		})
	);
	// for (const channel of channels) {
	//
	// }
}

async function processChannelHistory(
	history: Record<string, any>
): Promise<string> {
	const members = await getMembers();
	const files: Record<string, any>[] = [];
	const memberIdMap = members.reduce(
		(obj: Record<string, Member>, member: Member) => ({
			...obj,
			[member.id as string]: member,
		}),
		{}
	);
	history.messages.forEach((message: Record<string, any>) => {
		if (message.files) {
			files.push(...message.files);
		}
	});
	console.log("fetching files");
	await Promise.all(
		files.map((f) => {
			if (!f.url_private_download) {
				console.log(`File with no URL: ${f.id} // ${f.name}`);
				return Promise.resolve();
			}
			return axios
				.get(f.url_private_download, {
					responseType: "arraybuffer",
					headers: {
						Authorization: `Bearer ${process.env.SLACK_TOKEN}`,
					},
				})
				.then((response) =>
					fs.writeFile(
						"./out/private-channels/chat__G977U7MDJ__files/" +
							`${f.id}__${f.name}`,
						response.data
					)
				)
				.catch((e) => {
					console.log(e);
					console.log(f);
				});
		})
	);
	console.log("processing messages");
	const processedMessages = history.messages.map(
		(message: Record<string, any>) =>
			`<p>${dayjs
				.unix(parseFloat(message.ts))
				.format("M/D/YY h:mm A")} <b>${
				escapeHtml(memberIdMap[message.user]?.real_name) ||
				`Unknown user ${escapeHtml(message.user)}`
			}:</b> ${
				escapeHtml(
					message.text.replace(/&gt;/g, ">").replace(/&lt;/g, "<")
				).replace(/\n/g, "<br/>") || "<NO TEXT>"
			} ${
				message.files != undefined
					? `(${message.files.length} attached file${
							message.files.length !== 1 ? "s" : ""
					  }) ${message.files
							.filter((f) => f.mimetype.indexOf("image") > -1)
							.map(
								(f) => `
						  <img src="${
								"./chat__G977U7MDJ__files/" +
								`${f.id}__${f.name}`
							}"/>`
							)
							.join("")}`
					: ""
			}</p>`
	);

	return wrapHTML(`
<h1>${history.info.name} </h1>
<p>Created ${dayjs
		.unix(parseFloat(history.info.created))
		.format("M/D/YY h:mm A")}</p>
<p>All times reported in UTC${dayjs().utcOffset() / 60}:${
		dayjs().utcOffset() % 60 == 0 ? "00" : dayjs().utcOffset() % 60
	}</p>
<hr/>
<div class="messages">
${processedMessages.join("\n")}
</div>
`);
}

async function main() {
	// console.log(await getMembers());
	// exportAllChannels();
	fs.readFile("./out/private-channels/chat__G977U7MDJ.json")
		.then((data) => JSON.parse(data + ""))
		.then((obj) => processChannelHistory(obj))
		.then((txt) =>
			fs.writeFile("./out/private-channels/chat__G977U7MDJ.html", txt)
		);
}

main();
