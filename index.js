const {Discord, Client, Guild, GuildChannel, TextChannel} = require("discord.js");
const mongoose = require("mongoose");
const helper = require("./Bot.json");
const client = new Client();
const Bots = global.Bots = [];

// Mongoose
mongoose.connect("", {useNewUrlParser: true, useUnifiedTopology: true});
mongoose.connection.on("connected", () => {
    console.log("MongoDB bağlanıldı.")
});

const roleSchema = new mongoose.Schema({
    Id: String,
    Members: {type: Array, default: []}
});

const Role = mongoose.model("Role", roleSchema);

const channelSchema = new mongoose.Schema({
    Id: String,
    Type: String,
    Permissions: {type: Array, default: []}
});

const Channel = mongoose.model("Channel", channelSchema);
// Mongoose

let Tokens = helper.Tokens;
let danger = false;

Tokens.forEach(token => {
    let bot = new Client();

    bot.on("ready", () => {
        console.log(`${bot.user.tag} - Destekçi bot olarak aktif.`);
        bot.Busy = false;
        bot.Uj = 0;
        Bots.push(bot);
    })

    bot.login(token).then(e => {
    }).catch(e => {
        console.error(`${token.substring(Math.floor(token.length / 2))} giriş yapamadı.`);
    });
});

client.on("ready", async () => {
    console.log("Ana bot aktifleşti.");
    await backup();
    setInterval(() => {
        if(danger != true) backup();
    }, 60000)
});

async function backup(){
    let guild = client.guilds.cache.first();
    await Role.deleteMany({});
    guild.roles.cache.filter(e => !e.managed).forEach(async role => {
        await new Role({
            Id: role.id,
            Members: role.members.map(e => e.id)
        }).save()
    });
    await Channel.deleteMany({});
    guild.channels.cache.forEach(async channel => {
        await new Channel({
            Id: channel.id,
            Type: channel.type,
            Permissions: channel.permissionOverwrites.array()
        }).save();
    })
    console.log("yedek alındı")
}

client.on("roleCreate", async (role) => {
    let logs = await role.guild.fetchAuditLogs({limit: 5,type:"ROLE_CREATE"}).then(e => e.entries.sort((x, y) => y.createdTimestamp - x.createdTimestamp));
    let log = logs.find(e => ((Date.now() - e.createdTimestamp) / (1000)) < 5);
    if(!log || (log && safe(log.executor.id))) return;

    let bot = giveBot(1)[0];
    processBot(bot, true, 1);

    let guild = bot.guilds.cache.first();
    let nrole = guild.roles.cache.get(role.id);
    if(nrole && !nrole.deleted) nrole.delete().catch();
    let member = guild.member(log.executor.id);
    if(member && member.kickable) member.kick().catch();
    let channel = guild.channels.cache.get(helper.Kanal);
    if(channel) channel.send(`${log.executor}(${log.executor.id}) tarafından bir rol oluşturuldu. Oluşturulan rol silindi, kişi sunucudan ${member.kickable ? "atıldı" : "atılamadı"}.`);
    processBot(bot, false, -1);
});

client.on("roleDelete", async (role) => {
    let logs = await role.guild.fetchAuditLogs({limit: 5,type:"ROLE_DELETE"}).then(e => e.entries.sort((x, y) => y.createdTimestamp - x.createdTimestamp));
    let log = logs.find(e => ((Date.now() - e.createdTimestamp) / (1000)) < 5);
    if(!log || (log && safe(log.executor.id))) return;
    danger = true;

    closeAllPerms();
    
    let guild = client.guilds.cache.first();
    let member = guild.member(log.executor.id);
    if(member && member.kickable) member.kick().catch();
    let channel = guild.channels.cache.get(helper.Kanal);
    if(channel) channel.send(`${log.executor}(${log.executor.id}) tarafından bir rol silindi. Silinen rol tekrar kurulacak, kişi sunucudan ${member.kickable ? "atıldı" : "atılamadı"}.`);
    
    // Rol dağıtma işlemi
    let nrole = await role.guild.roles.create({
        data:{
            color: role.color,
            hoist: role.hoist,
            mentionable: role.mentionable,
            name: role.name,
            permissions: role.permissions,
            position: role.rawPosition
        }
    }).catch();
    let data = await Role.findOneAndUpdate({Id: role.id}, {$set: {Id: nrole.id}}).exec();
    if(!data) return console.log(`[${role.id}] Olayında kayıtlı bir veri olmadığından dolayı rol dağıtımı gerçekleşmedi.`);

    Channel.updateMany({"Permissions.id": role.id}, {$set: {"Permissions.$.id": nrole.id}}, {upsert: true}).exec(async (e,res) => {
        if(e) console.error(e);
        console.log("işlem var");
        let _bot = giveBot(1)[0];
        let data = await Channel.find({"Permissions.id": nrole.id});
        if(!data || nrole.deleted) return console.log("işlem iptal");
        for (let index = 0; index < data.length; index++) {
            const element = data[index];
            if(nrole.deleted) break;
            let _channel = _bot.guilds.cache.first().channels.cache.get(element.Id);
            if(!_channel){
                console.log("kanal yok");
                continue;
            }
            _channel.edit({
                type: element.Type,
                permissionOverwrites: element.Permissions
            });
        }
    });

    let length = data.Members.length;
    if(length <= 0) return console.log(`[${role.id}] Olayında kayıtlı üye olmadığından dolayı rol dağıtımı gerçekleştirmedim.`);
    let availableBots = Bots.filter(e => !e.Busy);
    if(availableBots.length <= 0) availableBots = Bots.sort((x,y) => y.Uj - x.Uj).slice(0, Math.round(length / Bots.length));
    let perAnyBotMembers = Math.floor(length / availableBots.length);
    if(perAnyBotMembers < 1) perAnyBotMembers = 1;
    for (let index = 0; index < availableBots.length; index++) {
        const bot = availableBots[index];
        if(nrole.deleted){
            console.log(`[${role.id}] Olayından sonra ${bot.user.username} - rol tekrar silindi, döngü kırılıyor.`);
            break;
        }
        processBot(bot, true, perAnyBotMembers);
        let ids = data.Members.slice(index * perAnyBotMembers, (index + 1) * perAnyBotMembers);
        if(ids.length <= 0) {processBot(bot, false, -perAnyBotMembers); break;}
        let guild = bot.guilds.cache.first();
        ids.every(async id => {
            if(nrole.deleted){
                processBot(bot, false, -perAnyBotMembers);
                console.log(`[${role.id}] Olayından sonra ${bot.user.username} - rol tekrar silindi, döngü kırılıyor. #2`);
                return false;
            }
            let member = guild.member(id);
            if(!member){
                console.log(`[${role.id}] Olayından sonra ${bot.user.username} - ${id}'yi bulamadım.`);
                return true;
            }
            await member.roles.add(nrole.id).then(e => {console.log(`[${role.id}] Olayından sonra ${bot.user.username} - ${id} ${nrole.name} rolünü aldı.`);}).catch(e => {console.log(`[${role.id}] Olayından sonra ${bot.Bot.user.username} - ${id}'ye rol veremedim.`);});
        });
        processBot(bot, false, -perAnyBotMembers);
    }
    // Rol dağıtma işlemi (SON)
});

client.on("roleUpdate", async (oldRole, newRole) => {
    let guild = oldRole.guild;
    let logs = await guild.fetchAuditLogs({limit: 5,type:"ROLE_UPDATE"}).then(e => e.entries.sort((x, y) => y.createdTimestamp - x.createdTimestamp));
    let log = logs.find(e => ((Date.now() - e.createdTimestamp) / (1000)) < 5);
    if(!log || (log && safe(log.executor.id))) return;

    newRole.edit({
        color: oldRole.color,
        hoist: oldRole.hoist,
        mentionable: oldRole.mentionable,
        name: oldRole.name,
        permissions: oldRole.permissions,
        position: oldRole.position
    });

    let bot = giveBot(1)[0];
    guild = bot.guilds.cache.first();
    let member = guild.member(log.executor.id);
    if(member && member.kickable) member.kick().catch();

    let channel = guild.channels.cache.get(helper.Kanal);
    if(channel) channel.send(`${log.executor}(${log.executor.id}) tarafından bir rol güncellendi. Yeni rol, eski rol olarak güncellenecek kişi sunucudan ${member.kickable ? "atıldı" : "atılamadı"}.`);
});

client.on("channelCreate", async (channel) => {
    let guild = channel.guild;

    let logs = await guild.fetchAuditLogs({limit: 5,type:"CHANNEL_CREATE"}).then(e => e.entries.sort((x, y) => y.createdTimestamp - x.createdTimestamp));
    let log = logs.find(e => ((Date.now() - e.createdTimestamp) / (1000)) < 5);
    if(!log || (log && safe(log.executor.id))) return;
    if(!channel.deleted) channel.delete();

    let bot = giveBot(1)[0];
    processBot(bot, true, 1);

    guild = bot.guilds.cache.first();
    let member = guild.member(log.executor.id);
    if(member && member.kickable) member.kick().catch();
    let logChannel = guild.channels.cache.get(helper.Kanal);
    if(logChannel) logChannel.send(`${log.executor}(${log.executor.id}) tarafından bir kanal oluşturuldu. Oluşturulan kanal silindi, kişi sunucudan ${member.kickable ? "atıldı" : "atılamadı"}.`);
    processBot(bot, false, -1);
});

client.on("channelDelete", async (channel) => {
    let guild = channel.guild;
    let logs = await guild.fetchAuditLogs({limit: 5,type:"CHANNEL_DELETE"}).then(e => e.entries.sort((x, y) => y.createdTimestamp - x.createdTimestamp));
    let log = logs.find(e => ((Date.now() - e.createdTimestamp) / (1000)) < 5);
    if(!log || (log && safe(log.executor.id))) return;

    let bot = giveBot(1)[0];
    processBot(bot, true, 1);

    guild = bot.guilds.cache.first();
    let member = guild.member(log.executor.id);
    if(member && member.kickable) member.kick().catch();

    let data = await Channel.findOne({Id: channel.id});
    if(!data) return console.error(`[CHANNEL_DELETE] (${channel.id}) olayında herhangi bir veri kaydı bulamadığım için işlemi iptal ediyorum.`);

    guild.channels.create(channel.name, {
        bitrate: channel.bitrate,
        nsfw: channel.nsfw,
        parent: channel.parent,
        position: channel.position,
        rateLimitPerUser: channel.rateLimitPerUser,
        permissionOverwrites: data.Permissions,
        topic: channel.topic,
        type: channel.type,
        userLimit: channel.userLimit
    });

    processBot(bot, false, -1);
    let logChannel = guild.channels.cache.get(helper.Kanal);
    if(logChannel) logChannel.send(`${log.executor}(${log.executor.id}) tarafından bir kanal silindi. Silinen kanal oluşturuldu, kişi sunucudan ${member.kickable ? "atıldı" : "atılamadı"}.`);
});

client.on("channelUpdate",async (oldChannel, newChannel) => {
    let guild = oldChannel.guild;
    let logs = await guild.fetchAuditLogs({limit: 5,type:"CHANNEL_UPDATE"}).then(e => e.entries.sort((x, y) => y.createdTimestamp - x.createdTimestamp));
    let log = logs.find(e => ((Date.now() - e.createdTimestamp) / (1000)) < 5);
    if(!log || log && safe(log.executor.id)) return;

    let bot = giveBot(1)[0];
    processBot(bot, true, 1);

    guild = bot.guilds.cache.first();
    let member = guild.member(log.executor.id);
    if(member && member.kickable) member.kick().catch();

    let data = await Channel.findOne({Id: oldChannel.id});
    if(!data) return console.error(`[CHANNEL_UPDATE] (${oldChannel.id}) olayında herhangi bir veri kaydı bulamadığım için işlemi iptal ediyorum.`);
    console.log(data.Permissions);
    newChannel.edit({
        name: oldChannel.name,
        bitrate: oldChannel.bitrate,
        nsfw: oldChannel.nsfw,
        parent: oldChannel.parent,
        permissionOverwrites: data.Permissions,
        position: oldChannel.position,
        rateLimitPerUser: oldChannel.rateLimitPerUser,
        topic: oldChannel.topic,
        type: oldChannel.type,
        userLimit: oldChannel.userLimit
    });
    processBot(bot, false, -1);
    let logChannel = guild.channels.cache.get(helper.Kanal);
    if(logChannel) logChannel.send(`${log ? log.executor : "Herhangi bir rol silindiği için"}(${log ? log.executor.id : "yok"}) tarafından bir kanal güncellendi. ${log ? `Sunucudan ${member.kickable ? "atıldı" : "atılamadı"}` : ""}`);
})

client.on("guildMemberAdd", async (member) => {
    if(!member.user.bot) return;
    let guild = member.guild;
    let logs = await guild.fetchAuditLogs({limit: 5,type:"BOT_ADD"}).then(e => e.entries.sort((x, y) => y.createdTimestamp - x.createdTimestamp));
    let log = logs.find(e => ((Date.now() - e.createdTimestamp) / (1000)) < 5);
    if(log && safe(log.executor.id)) return;
    if(!log) return member.kick();
    if(member.kickable) member.kick();
    let bot = giveBot(1)[0];

    guild = bot.guilds.cache.first();

    let author = guild.member(log.executor.id);
    if(author && author.kickable) author.kick();

    let channel = bot.channels.cache.get(helper.Kanal);
    if(channel) channel.send(`${log.executor}(${log.executor.id}) tarafından sunucuya bot eklendi. Bot sunucudan atıldı, getiren kişi de onla beraber gitti. :D`);
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
    let guild = newMember.guild;
    if(oldMember.nickname != newMember.nickname){
        let logs = await guild.fetchAuditLogs({limit: 5, type:"MEMBER_UPDATE"}).then(e => e.entries.sort((x, y) => y.createdTimestamp - x.createdTimestamp));
        let log = logs.find(e => ((Date.now() - e.createdTimestamp) / (1000)) < 5);
        if(!log || log && safe(log.executor.id)) return;
        if(member.kickable) member.kick();
        let bot = giveBot(1)[0];
    
        guild = bot.guilds.cache.first();
    
        let author = guild.member(log.executor.id);
        if(author) author.roles.set(author.roles.cache.filter(e => !e.permissions.has("MANAGE_ROLES")));
    
        let channel = bot.channels.cache.get(helper.Kanal);
        if(channel) channel.send(`${log.executor}(${log.executor.id}) tarafından izinsiz isimler değiştirilmeye kalkışıldı. Kişinin isim değiştirme yetkisine el konuldu. :D`);
        return;
    }

    if(newMember.roles.cache.some(r1 => !oldMember.roles.cache.has(r1.id))){
        let logs = await guild.fetchAuditLogs({limit: 1, type:"MEMBER_ROLE_UPDATE"});
        let log = logs.entries.first();
        if(log && safe(log.executor.id)) return;

        let bot = giveBot(1)[0];
        let roles = newMember.roles.cache.filter(r1 => !oldMember.roles.cache.has(r1.id));
        if(roles.some(e => e.permissions.has("ADMINISTRATOR") || e.permissions.has("MANAGE_ROLES") || e.permissions.has("BAN_MEMBERS") || e.permissions.has("KICK_MEMBERS") || e.permissions.has("MANAGE_GUILD"))){
            let _guild = bot.guilds.cache.first();

            let author = _guild.member(log.executor.id);
            if(author && author.kickable) author.kick();
            let member = _guild.member(oldMember.id);
    
            member.roles.set(oldMember.roles.cache.filter(e => !e.deleted || e.managed));
        }

        let channel = bot.channels.cache.get(helper.Kanal);
        if(channel) channel.send(`${log.executor}(${log.executor.id}) tarafından ${newMember} kişisine rol verildiği için kişinin rol verme yetkilerine el konuldu. :D`);
    }
});


function giveBot(length){
    if(length > Bots.length) length = Bots.length;
    let availableBots = Bots.filter(e => !e.Busy);
    if(availableBots.length <= 0) availableBots = Bots.sort((x,y) => x.Uj - y.Uj).slice(0, length);

    return availableBots;
}

function processBot(bot, busy, job, equal = false){
    bot.Busy = busy;
    if(equal) bot.Uj = job;
    else bot.Uj += job;

    let index = Bots.findIndex(e => e.user.id == bot.user.id);
    Bots[index] = bot;
}

function safe(id){
    if(id == client.user.id || Bots.some(e => e.user.id == id) || helper.Izinliler.includes(id)) return true;
    return false;
}

function closeAllPerms(){
    let guild = client.guilds.cache.get(helper.Guild);
    let roles = guild.roles.cache.filter(role => role.managed && role.position < guild.me.roles.highest.position && role.permissions.has("MANAGE_GUILD") || role.permissions.has("BAN_MEMBERS") || role.permissions.has("MANAGE_ROLES") || role.permissions.has("MANAGE_WEBHOOKS") || role.permissions.has("MANAGE_NICKNAMES") || role.permissions.has("MANAGE_CHANNELS"));

    roles.forEach(role => {
        if(role.permissions.has("ADMINISTRATOR")){
            role.members.filter(e => e.manageable).forEach(member => {
                if(safe(member.id)) return;
                if(member.roles.highest.position < guild.me.roles.highest.position) member.roles.remove(role).catch();
            });
        }
        else role.setPermissions(0).catch();
    });
}

client.login(helper.Token);
