let AWS = require("aws-sdk");
const mysql = require('mysql2/promise');
const util = require('util');

let secretsManager = new AWS.SecretsManager();
let {SM_EXAMPLE_DATABASE_CREDENTIALS, URL_RDS_PROXY} = process.env;

exports.handler = async (event) => {
  let sm = await secretsManager.getSecretValue({SecretId: SM_EXAMPLE_DATABASE_CREDENTIALS}).promise();
  let credentials = JSON.parse(sm.SecretString);

  console.log(event);

  let connectionConfig = {
    host: URL_RDS_PROXY,
    port: credentials.port,
    // username: credentials.username,
    user: credentials.username,
    password: credentials.password,
    database: credentials.dbname,
    ssl: {
      rejectUnauthorized: false
    },
    connectionLimit: 10,
  };

  let sql = await mysql.createConnection(connectionConfig);

  // MySQLデータベースへの接続
  // sql.connect();

  if (event.info.parentTypeName === "Mutation") {
    let newCar = event.arguments.input;
    newCar.id = `CAR${Date.now()}${Math.random().toString(16).slice(2)}`;
    let [car] = await sql`INSERT INTO Car ${sql(newCar)} RETURNING ${sql(Object.keys(newCar))}`;
    return car;
  }

  let payload = {};

  //['id']
  let parkingColumns = event.info.selectionSetList.filter((item) => !item.startsWith("car"));

  let sqlText = `SELECT ${parkingColumns} FROM Parking WHERE id = "${event.arguments.id}"`;

  const [rows] = await sql.execute(sqlText, []);

  let [parking] = rows;

  payload = {...parking};

  if (event.info.selectionSetList.some((item) => item === "car")) {
    let carColumns = event.info.selectionSetList.filter((item) => item.startsWith("car/") && !item.includes("parking")).map((item) => item.split("/")[1]);
    let [car] = await sql`SELECT ${carColumns} FROM Car WHERE parking_id = ${parking.id}`;

    payload.car = {...car};
  }

  if (event.info.selectionSetList.some((item) => item === "car/parking")) {
    let carParkingColumns = event.info.selectionSetList.filter((item) => item.startsWith("car/parking/")).map((item) => item.split("/")[2]);

    if (carParkingColumns.every((col) => parking[col])) {
      payload.car.parking = {};
      carParkingColumns.forEach((col) => {
        payload.car.parking[col] = parking[col];
      });
    } else {
      let parkingExtraColumns = carParkingColumns.filter((item) => !parkingColumns.includes(item));
      let [parkingExtraFields] = await sql`SELECT ${parkingExtraColumns} FROM Parking WHERE id = ${event.arguments.id}`;
      payload.car.parking = {...parking, ...parkingExtraFields};
    }
  }

  await sql.end({timeout: 0});

  return payload;
};
