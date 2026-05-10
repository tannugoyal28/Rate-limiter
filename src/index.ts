import express from "express";

const app = express();
app.use(express.json());

app.get('/',(req,res)=>{
    res.send("working fine");
})

app.listen(3000,()=>{
    console.log(`Listening at port 3000`);
})
