# cdk-playground

- Various cloud infra built with AWS CloudFormation
- IAC (Infrastructure As Code)


## Prerequisite

<details>
<summary>Prerequisite</summary>

- Install aws CLI

- Install node, npm
	- `brew install node`

- Install CDL CLI
	- `npm install -g aws-cdk`

- Config aws CLI
	- `brew install awscli`
	- `aws configure`

- Install needed pkg
	- `npm install aws-cdk-lib constructs`

- Remove cache & install pkgs
	- `rm -rf node_modules package-lock.json`
	- `npm install`


</details>


## Init CDK Stack

<details>
<summary>Init CDK stack</summary>


```bash
# init project
cdk init sample-app --language typescript


# compile TS code
npm run build


# show all CDK
cdk list # or : cdk list --long

# (ONLY first time) install the bootstrap stack into an environment, save needed pkg in S3
cdk bootstrap
```

</details>



## Deploy

<details>
<summary>Deploy</summary>


```bash
# Synthesizes and prints the CloudFormation : template for this stack 
cdk synth # or : cdk synthesize

# diff
cdk diff

# deploy
cdk deploy

# deploy
# which will assess whether a hotswap deployment can be performed instead of a CloudFormation deployment. If possible, the CDK CLI will use AWS service APIs to directly make the changes; otherwise it will fall back to performing a full CloudFormation deployment.
cdk deploy --hotswap

# sync
#  except that instead of being a one-shot operation, it monitors your code and assets for changes and attempts to perform a deployment automatically when a change is detected.
cdk watch

# destroy CDK
cdk destroy CdkWorkshopStack
```

</details>

## CDK code structure

<details>
<summary>CDK code structure</summary>

```
├── bin
│   └── cdk-demo.ts
├── cdk.json
├── jest.config.js
├── lib
│   └── cdk-demo-stack.ts
├── package.json
├── package-lock.json
├── README.md
├── test
│   └── cdk-demo.test.ts
└── tsconfig.json

- bin/cdk-project.ts - 這是進入 CDK 應用程式的途徑。此檔案將會載入/建立我們在 lib/* 底下定義的所有堆疊

- lib/cdk-project-stack.ts - 這是主要的 CDK 應用程式堆疊的定義之處。資源及其屬性可存放於此處。

- package.json - 您會在此處定義專案相依性，以及一些額外資訊和建置指令碼 (npm build、npm test、npm watch)。

- cdk.json - 此檔案會向工具組指出如何執行你的應用程式，以及與 CDK 和你的專案相關的一些額外設定和參數。

- tsconfig.json：typescript 設定檔

- .npmignore：告訴 npm 應該要排除的文件

- node_modules：nodejs 套件包執行完 npm install 後的文件都會安裝在此資料夾裡面

- test：CDK 測試的程式位置

```

</details>


## Ref
- https://github.com/aws-samples/aws-cdk-examples
- https://github.com/yennanliu/CDKPoc
