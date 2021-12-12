export default function wrapHTML(body: string) {

    return `
<!DOCTYPE html>
<html>

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="author" content="Jeffrey Meng">
    <link rel="stylesheet" type="text/css" href="https://cdn.jeffkmeng.com/library/bootstrap/4.1.3/css/bootstrap.min.css">
    <title>Jeffrey Template</title>
    <style>
        /* https://stackoverflow.com/a/3525675/5511561 */

        html,
        body {
            margin: 0px;
            padding: 0px;
            min-height: 100%;
            height: 100%;
        }

        .container {
            min-height: 100%;
            height: auto !important;
            margin-bottom: -50px;
            /* the bottom margin is the negative value of the footer's total height */
        }

        .container:after {
            content: "";
            display: block;
            height: 50px;
            /* the footer's total height */
        }



        .footer {
            height: 50px;
            /* the footer's total height */
        }

        .footer-content {

            height: 32px;
            /* height + top/bottom padding + top/bottom border must add up to footer height */
            padding: 8px;
        }
    </style>
</head>

<body>
    <div class="container">
        <div class="col-lg-12 pt-3">
            ${body}
        </div>
    </div>
    <script src="https://cdn.jeffkmeng.com/library/jquery/3.3.1/jquery.min.js"></script>

    <script src="https://cdn.jeffkmeng.com/library/bootstrap/4.1.3/js/bootstrap.bundle.min.js"></script>
</body>

</html>
    `
}