# Slack Exporter

A utility for exporting slack channels visible to you.
To use it, set the `SLACK_TOKEN` environment variable with a slack API token, after which you can run `yarn install` and `yarn build`, then run `./build/index.js`. This will export all channels that are visible to your slack token. If you have other specific needs, it should be fairly easy to modify the source code for your own needs.
