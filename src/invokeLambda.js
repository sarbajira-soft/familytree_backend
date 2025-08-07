const AWS = require('aws-sdk');

AWS.config.update({ region: 'ap-south-1' }); // your region here

const lambda = new AWS.Lambda();

const params = {
  FunctionName: 'familytreebackend', // your lambda function name
  Payload: JSON.stringify({ httpMethod: 'GET', path: '/' }),
};

lambda.invoke(params, (err, data) => {
  if (err) {
    console.error('Error invoking Lambda:', err);
  } else {
    console.log('Lambda response:', JSON.parse(data.Payload));
  }
});
