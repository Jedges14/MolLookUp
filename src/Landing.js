import './Landing.css';

const LandingPage = () => {
    return (
        
        <>
        <div className ="Title_Box">
            {/* three bar logo for menu lives here */}
            <div className="nav-bar">
                <nav>
                    <ul>
                        <li>Home</li>
                        <li>Back</li>
                        <li>Contact</li>
                    </ul>
                </nav>
            </div>
            <div className="wesbiteName">
                <h2>MolLookUp</h2>
            </div>
            {/* user icon lives here */}
            <div className="UserLogin"><h3>UserLogin</h3></div>
        </div>

        <div className="fact-Container">
            <div className="Random-Mol-fact"></div>
            <div className="Mol-History"></div>
        </div>

        {/* input the search */}
        <div className="Search-Container">
            <form>
                <label for ="input">
                    <p className="style input search header">Find chemical compounds, see 3D models, and explore molecular data.</p>
                </label>
                <input type="text" id="input" name="search" placeholder='Enter molecule name here'></input>
            </form>
        </div>

        <div className="description-field area"></div>

        <div className="footer-Area">
            <footer></footer>
        </div>
    </>

    )
}

export default LandingPage;