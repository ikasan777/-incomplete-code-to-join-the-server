process.noDeprecation = true;
const chalk = require("chalk");
const gradient = require("gradient-string");
const { Client } = require("discord.js-selfbot-v13");
const config = require("./config.json");
const fs = require("fs");
const readline = require('readline');
const {
  CapMonsterCloudClientFactory,
  ClientOptions,
  HCaptchaProxylessRequest
} = require("@zennolab_com/capmonstercloud-client");

let totalJoined = 0;
let failed = 0;

const inviteCode = config.invite.includes(".")
  ? config.invite.match(/\/([^/]+)$/)?.[1] || ""
  : config.invite;

const delayBetweenJoins = config.joinDelay || 5000;

console.log(gradient.rainbow("にゃる！"));

(async () => {
  console.log(chalk.blueBright("[処理開始] Capmonsterクライアントを作成"));
  const cmClient = CapMonsterCloudClientFactory.Create(
    new ClientOptions({ clientKey: config.capmonsterApiKey })
  );

  async function readTokens() {
    console.log(chalk.blueBright("[処理開始] tokens.txtからtokenを読み込み中"));
    const tokens = fs
      .readFileSync("tokens.txt")
      .toString()
      .split("\n")
      .filter(Boolean);

    for (const token of tokens) {
      console.log(chalk.blueBright(`[処理開始]サーバー参加処理を開始`));
      await joinServer(token, cmClient);
      console.log(chalk.blueBright(`[処理中] ${delayBetweenJoins}ms 待機中...`));
      await new Promise((resolve) => setTimeout(resolve, delayBetweenJoins));
    }

    console.log(
      `${chalk.magentaBright("[情報]")} 処理完了: ${gradient.passion(
        totalJoined
      )} サーバーに参加、${gradient.passion(failed)} サーバーへの参加に失敗しました`
    );
  }

  async function joinServer(token, cmClient) {
    const client = new Client({ checkUpdate: false, browser: "Discord iOS" });

    client.on("ready", async () => {
      console.log(chalk.green("ログイン成功: ") + gradient.cristal(client.user.tag));
      console.log(`クライアントID: ${client.user.id}`);

      let joinAttempts = 0;
      const maxJoinAttempts = 5;
      let captchaSolution = null;

      while (joinAttempts < maxJoinAttempts) {
        try {
          console.log(chalk.blueBright("[処理中] 招待コードを取得中"));
          const invite = await client.fetchInvite(inviteCode);
          console.log(chalk.blueBright("[処理中] サーバーに参加処理"));
          
          if (captchaSolution) {
            await invite.acceptInvite(captchaSolution);
          } else {
            await invite.acceptInvite();
          }

          console.log(chalk.greenBright(`参加成功: ${gradient.passion(client.user.tag)}`));
          totalJoined++;
          break;
        } catch (err) {
          if (err.captcha) {
            console.log(chalk.blueBright("[処理中] CAPTCHA出たから、手動で解決するか、Capmonsterで解決するか選択してください"));
            const choice = await getUserChoice();
            if (choice === 'manual') {
              captchaSolution = await getManualCaptchaSolution(err.captcha);
            } else {
              try {
                captchaSolution = await solveCaptcha(err.captcha, cmClient);
                console.log(chalk.blueBright("[処理中] CAPTCHAを解決しました。30秒待機します..."));
                await new Promise(resolve => setTimeout(resolve, 30000)); // 30秒待機
              } catch (capmonsterError) {
                console.error(chalk.redBright(`[Capmonster] エラー: ${capmonsterError.message}`));
                failed++;
                break;
              }
            }
            // ループの先頭に戻って再度サーバー参加を試みる
          } else {
            console.error(chalk.redBright(`参加エラー: ${err.message}`));
            failed++;
            break;
          }
        }
        joinAttempts++;
        if (joinAttempts < maxJoinAttempts) {
          console.log(chalk.blueBright(`[処理中] 10秒待機後、再試行します...`));
          await new Promise(resolve => setTimeout(resolve, 10000)); // 10秒待機
        }
      }

      process.title = `参加成功: ${totalJoined} | 失敗: ${failed}`;
      console.log(chalk.blueBright('[処理終了] クライアントなんて知りませんバイバイです さいならー'));
      client.destroy();
    });

    console.log(chalk.blueBright(`[処理中] ログイン中`));
    client.login(token).catch((err) => {
      console.log(`${chalk.redBright("[エラー]")} 無効なトークンまたはログイン失敗: ${gradient.instagram(token)} (${err.message})`);
      failed++;
      process.title = `参加成功: ${totalJoined} | 失敗: ${failed}`;
    });
  }

  async function solveCaptcha(captchaData, cmClient) {
    const { captcha_sitekey, captcha_rqdata, captcha_rqtoken } = captchaData;
    const captchaUrl = "https://discord.com/";

    console.log(chalk.yellowBright(`[デバッグ] sitekey: ${captcha_sitekey}`));
    console.log(chalk.yellowBright(`[デバッグ] rqdata: ${captcha_rqdata}`));
    console.log(chalk.yellowBright(`[デバッグ] rqtoken: ${captcha_rqtoken}`));

    const hcaptchaRequest = new HCaptchaProxylessRequest({
      websiteURL: captchaUrl,
      websiteKey: captcha_sitekey,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
      isInvisible: true,
      data: captcha_rqdata,
      rqtoken: captcha_rqtoken,
    });

    const response = await cmClient.Solve(hcaptchaRequest);
    if (response && response.solution) {
      console.log(chalk.blueBright(`[Capmonster] CAPTCHA解決結果を取得した`));
      return {
        captcha_key: response.solution.gRecaptchaResponse,
        captcha_rqtoken: captcha_rqtoken
      };
    } else {
      throw new Error("CAPTCHA解決失敗");
    }
  }

  async function getUserChoice() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question('CAPTCHAの解決方法を選択してください (manual/auto): ', (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'manual' ? 'manual' : 'auto');
      });
    });
  }

  async function getManualCaptchaSolution(captchaData) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log(chalk.yellow(`CAPTCHAを手動で解決してください。`));
    console.log(chalk.yellow(`サイトキー: ${captchaData.captcha_sitekey}`));
    console.log(chalk.yellow(`rqdata: ${captchaData.captcha_rqdata}`));

    return new Promise((resolve) => {
      rl.question('解決したCAPTCHAの応答を入力してください: ', (answer) => {
        rl.close();
        resolve({
          captcha_key: answer,
          captcha_rqtoken: captchaData.captcha_rqtoken
        });
      });
    });
  }

  readTokens();
})();