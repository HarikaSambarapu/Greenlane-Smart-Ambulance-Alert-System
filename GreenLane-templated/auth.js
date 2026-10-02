// auth.js

console.log("AUTH.JS CONNECTED");


import { auth, db } from "./firebase.js";


import {

createUserWithEmailAndPassword,
signInWithEmailAndPassword,
sendPasswordResetEmail

}
from 
"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


import {

doc,
setDoc,
getDoc

}
from
"https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";



// ===============================
// SIGN UP
// ===============================

const signupBtn = document.getElementById("signupBtn");


if(signupBtn){

signupBtn.addEventListener("click", async()=>{


console.log("SIGNUP CLICKED");


const nameInput =
document.getElementById("name");


const emailInput =
document.getElementById("email");


const passwordInput =
document.getElementById("password");


const confirmPasswordInput =
document.getElementById("confirmPassword");


const signupErrorBox =
document.getElementById("signupError");



const name =
nameInput.value.trim();


const email =
emailInput.value.trim();


const password =
passwordInput.value;


const confirmPassword =
confirmPasswordInput.value;



// BUGFIX: the signup page's role field is now the hidden
// <select id="role"> driven by the clickable role cards, not a set
// of <input name="role"> radio buttons - querySelector('input[name=
// "role"]:checked') always returned null against that markup, so
// "Please select your role" fired on every submit no matter what
// was picked. A <select> always has a value (it defaults to its
// first <option selected>), so there's no unselected state to
// guard against here.
const roleSelect =
document.getElementById("role");



console.log({
nameInput,
emailInput,
passwordInput,
confirmPasswordInput,
roleSelect
});



if(!name || !email || !password || !confirmPassword){

signupErrorBox.innerText =
"Please fill all fields";

return;

}



if(!roleSelect || !roleSelect.value){

signupErrorBox.innerText =
"Please select your role";

return;

}



if(password !== confirmPassword){

signupErrorBox.innerText =
"Passwords do not match";

return;

}



try{


const userCredential =
await createUserWithEmailAndPassword(
auth,
email,
password
);



const user =
userCredential.user;



await setDoc(
doc(db,"users",user.uid),
{
name:name,
email:email,
role:roleSelect.value,
createdAt:new Date()
}
);



localStorage.setItem(
"role",
roleSelect.value
);


localStorage.setItem(
"name",
name
);


localStorage.setItem(
"email",
email
);


localStorage.setItem(
"uid",
user.uid
);



alert("Account created successfully");


window.location.href="login.html";


}

catch(err){


console.error(
"SIGNUP ERROR:",
err
);


signupErrorBox.innerText =
err.message;


}


});


}

// ===============================
// LOGIN
// ===============================


const loginBtn =
document.getElementById("loginBtn");


// BUGFIX: this used to look for <form id="loginForm"> and listen for
// its "submit" event (needed when the button was type="submit" inside
// a <form>, to preventDefault() the native page reload). The current
// login.html has no <form> at all - it's a plain type="button" button
// - so document.getElementById("loginForm") was always null, the
// listener never attached, and clicking Sign In did nothing. Listening
// for a click on the button directly matches that markup; there's no
// native submit to prevent, so no preventDefault() is needed.
if(loginBtn){


loginBtn.addEventListener("click",async()=>{


console.log("LOGIN CLICKED");



const email =
document.getElementById("loginEmail").value;


const password =
document.getElementById("loginPassword").value;



const error =
document.getElementById("loginError");



try{


const result =
await signInWithEmailAndPassword(
auth,
email,
password
);



const user =
result.user;



// Get role from Firestore


const userDoc =
await getDoc(
doc(db,"users",user.uid)
);



if(userDoc.exists()){


const data =
userDoc.data();



localStorage.setItem(
"role",
data.role
);



localStorage.setItem(
"name",
data.name
);



localStorage.setItem(
"email",
data.email
);



localStorage.setItem(
"uid",
user.uid
);




// Go dashboard

window.location.href="home.html";


}


else{


// BUGFIX / DIAGNOSTIC: this branch means the EMAIL + PASSWORD were
// correct (Firebase Authentication succeeded), but there is no
// matching document at users/{uid} in Firestore. That document is
// normally created by the sign-up flow above - if this account was
// ever created any other way (e.g. added directly in the Firebase
// console's Authentication tab), this is expected, since the console
// does not create a Firestore profile automatically.
console.error(
"No Firestore profile found at users/" + user.uid +
" - check Firestore Database > users collection for a document with exactly this ID."
);


error.innerHTML=
"We found your login, but no profile is set up for this account. " +
"If this account wasn't created through the sign-up page, its profile document is missing in Firestore.";


}



}


catch(err){


console.error(err);


error.innerHTML=
err.message;


}



});


}









// ===============================
// FORGOT PASSWORD
// ===============================


const resetBtn =
document.getElementById("resetBtn");



if(resetBtn){


resetBtn.addEventListener("click",async()=>{


const email =
document.getElementById("resetEmail").value;



try{


await sendPasswordResetEmail(
auth,
email
);



document.getElementById(
"resetSuccess"
).innerHTML=
"Reset link sent to your email";


}


catch(error){


document.getElementById(
"resetError"
).innerHTML=
error.message;


}



});


}