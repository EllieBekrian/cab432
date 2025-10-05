const loadtest = require('loadtest');
const path = require('path');
const fs = require('fs');

const options = {
    url: 'http://localhost:3000/api/v1/upload', 
    maxRequests: 200,  
    concurrency: 50,  
    method: 'POST',
    headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6InFxIiwiaWF0IjoxNzI0OTgyMDY5LCJleHAiOjE3MjQ5ODU2Njl9.69iM2ISmOEnUueWXvNtTak8o7BFOSSg8FoMji7M13H8', 
    },
};

function simulateLoadTest() {
    loadtest.loadTest(options, (error, result) => {
        if (error) {
            return console.error("Error during load test:", error);
        }
        console.log("Load test completed:", result);
        console.log("Total Requests:", result.totalRequests);
        console.log("Total Failures:", result.totalErrors);
    });
}

simulateLoadTest();

loadtest.loadTest(options, (error, result) => {
    if (error) {
        return console.error("Error during load test:", error);
    }
    console.log("Load test completed:", result);
    console.log("Total Requests:", result.totalRequests);
    console.log("Total Failures:", result.totalErrors);
});
